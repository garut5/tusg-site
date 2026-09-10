// Instagram Graph API - Content Publishing クライアント
//
// 参考: https://developers.facebook.com/docs/instagram-platform/content-publishing
//
// 対応するメディアタイプ:
//   IMAGE       静止画 1 枚 (画像 URL)
//   CAROUSEL    2〜10 枚の画像/動画 (子アイテムを作ってからカルーセルにまとめる)
//   REELS       縦動画 (9:16 推奨、3秒〜15分、MP4/MOV、~1GB)
//   STORIES     ストーリーズ (画像 or 動画、24 時間で消える)
//
// 共通の 2-step:
//   1. POST /me/media       → creation_id 取得
//   2. POST /me/media_publish → 実際に公開
//
// 動画系は upload → server 側のトランスコード完了を polling で待つ必要あり
// (画像より処理時間が長い、最大 5 分程度)。
//
// 使い方:
//   const ig = new InstagramClient(env);
//   await ig.publishSingle({ image_url, caption });
//   await ig.publishCarousel({ items: [{image_url}, {video_url}, ...], caption });
//   await ig.publishReel({ video_url, caption, share_to_feed: true });
//   await ig.publishStory({ image_url });  // or { video_url }

// Instagram Business Login (ig_biz_login_oauth) 経由で発行されたトークンは
// graph.instagram.com で使用。Facebook Login 経由なら graph.facebook.com。
// 環境変数 INSTAGRAM_GRAPH_HOST で切替可能 (default: graph.instagram.com)。
const DEFAULT_GRAPH_HOST = "https://graph.instagram.com";
const GRAPH_API_VERSION = "v21.0";
const MAX_CAROUSEL_ITEMS = 10;

// 画像は数秒で FINISHED、動画/リールは通常 30秒〜3分、大きな動画は最大 5 分
const POLL_INTERVAL_MS = 3000;
const IMAGE_TIMEOUT_MS = 60_000;
const VIDEO_TIMEOUT_MS = 300_000;

export class InstagramClient {
  constructor(env) {
    if (!env.INSTAGRAM_ACCESS_TOKEN) {
      throw new Error("INSTAGRAM_ACCESS_TOKEN is not configured");
    }
    if (!env.INSTAGRAM_BUSINESS_ACCOUNT_ID) {
      throw new Error("INSTAGRAM_BUSINESS_ACCOUNT_ID is not configured");
    }
    this.token = String(env.INSTAGRAM_ACCESS_TOKEN).trim();
    this.igUserId = String(env.INSTAGRAM_BUSINESS_ACCOUNT_ID).trim();
    const host = (env.INSTAGRAM_GRAPH_HOST || DEFAULT_GRAPH_HOST).replace(/\/$/, "");
    this.base = `${host}/${GRAPH_API_VERSION}`;
    this.isFacebookHost = host.includes("graph.facebook.com");
    this.selfPath = this.isFacebookHost ? `/${this.igUserId}` : "/me";
  }

  // --- 静止画 (Feed) ---
  async publishSingle({ image_url, caption }) {
    if (!image_url) throw new Error("image_url is required");
    const creationId = await this._createContainer({
      image_url,
      caption: caption || "",
    });
    await this._waitContainerReady(creationId, IMAGE_TIMEOUT_MS);
    return await this._publishContainer(creationId);
  }

  // --- カルーセル (Feed、画像 + 動画混在可) ---
  //   items: [{image_url}] or [{video_url}] を 2〜10 個
  async publishCarousel({ items, caption }) {
    if (!Array.isArray(items) || items.length < 2) {
      throw new Error("carousel requires at least 2 items");
    }
    if (items.length > MAX_CAROUSEL_ITEMS) {
      throw new Error(`carousel supports up to ${MAX_CAROUSEL_ITEMS} items`);
    }
    const itemIds = [];
    let hasVideo = false;
    for (const item of items) {
      const params = { is_carousel_item: true };
      if (item.image_url) {
        params.image_url = item.image_url;
      } else if (item.video_url) {
        params.media_type = "VIDEO";
        params.video_url = item.video_url;
        hasVideo = true;
      } else {
        throw new Error("carousel item requires image_url or video_url");
      }
      const itemId = await this._createContainer(params);
      // 動画子アイテムは処理完了を待たないと親カルーセル作成でエラーになる
      if (item.video_url) {
        await this._waitContainerReady(itemId, VIDEO_TIMEOUT_MS);
      }
      itemIds.push(itemId);
    }
    const carouselId = await this._createContainer({
      media_type: "CAROUSEL",
      children: itemIds.join(","),
      caption: caption || "",
    });
    const timeout = hasVideo ? VIDEO_TIMEOUT_MS : IMAGE_TIMEOUT_MS;
    await this._waitContainerReady(carouselId, timeout);
    return await this._publishContainer(carouselId);
  }

  // --- リール (縦動画、9:16 推奨) ---
  //   share_to_feed=true でフィードにも表示 (デフォルト true)
  //   cover_url を渡すとサムネイル画像を指定可能
  //   thumb_offset (ms) で動画内のサムネイル位置指定
  async publishReel({ video_url, caption, share_to_feed, cover_url, thumb_offset }) {
    if (!video_url) throw new Error("video_url is required");
    const params = {
      media_type: "REELS",
      video_url,
      caption: caption || "",
      share_to_feed: share_to_feed !== false, // default true
    };
    if (cover_url) params.cover_url = cover_url;
    if (thumb_offset != null) params.thumb_offset = thumb_offset;
    const creationId = await this._createContainer(params);
    await this._waitContainerReady(creationId, VIDEO_TIMEOUT_MS);
    return await this._publishContainer(creationId);
  }

  // --- ストーリーズ (画像 or 動画、24 時間で消える) ---
  async publishStory({ image_url, video_url }) {
    if (!image_url && !video_url) {
      throw new Error("story requires image_url or video_url");
    }
    const params = { media_type: "STORIES" };
    let timeout = IMAGE_TIMEOUT_MS;
    if (image_url) {
      params.image_url = image_url;
    } else {
      params.video_url = video_url;
      timeout = VIDEO_TIMEOUT_MS;
    }
    const creationId = await this._createContainer(params);
    await this._waitContainerReady(creationId, timeout);
    return await this._publishContainer(creationId);
  }

  // --- 内部ヘルパー ---
  async _createContainer(params) {
    const url = `${this.base}${this.selfPath}/media`;
    const body = new URLSearchParams({ access_token: this.token });
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      body.set(k, typeof v === "boolean" ? String(v) : String(v));
    }
    const res = await fetch(url, { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id) {
      throw new Error(`IG create container failed: ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
    }
    return data.id;
  }

  async _waitContainerReady(containerId, timeoutMs) {
    const url = `${this.base}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(this.token)}`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (data.status_code === "FINISHED") return;
      if (data.status_code === "ERROR" || data.status_code === "EXPIRED") {
        throw new Error(`IG container failed: ${JSON.stringify(data).slice(0, 300)}`);
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error(`IG container did not finish within ${timeoutMs}ms`);
  }

  async _publishContainer(creationId) {
    const url = `${this.base}${this.selfPath}/media_publish`;
    const body = new URLSearchParams({
      creation_id: creationId,
      access_token: this.token,
    });
    const res = await fetch(url, { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id) {
      throw new Error(`IG publish failed: ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
    }
    return { media_id: data.id };
  }

  async me() {
    const url = `${this.base}${this.selfPath}?fields=id,username,name&access_token=${encodeURIComponent(this.token)}`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`IG me() failed: ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
    }
    return data;
  }
}
