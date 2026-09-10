// Threads API - Content Publishing クライアント
//
// 参考: https://developers.facebook.com/docs/threads
//
// エンドポイントは graph.threads.net (Instagram Business Login と別スキーム)。
// トークンも Threads 専用アプリで発行された THREADS_ACCESS_TOKEN を使う。
//
// 2-step:
//   1. POST /me/threads          → creation_id
//   2. POST /me/threads_publish  → 実際の公開
//
// メディアタイプ (media_type param):
//   TEXT       テキストのみ (画像/動画 URL 不要)
//   IMAGE      画像 1 枚 (image_url)
//   VIDEO      動画 1 本 (video_url)
//   CAROUSEL   複数 (children で子アイテム ID を渡す)

const DEFAULT_HOST = "https://graph.threads.net";
const API_VERSION = "v1.0";
const POLL_INTERVAL_MS = 3000;
const TEXT_TIMEOUT_MS = 30_000;
const IMAGE_TIMEOUT_MS = 60_000;
const VIDEO_TIMEOUT_MS = 300_000;
const MAX_CAROUSEL_ITEMS = 10;
const TEXT_MAX = 500; // Threads は 500 文字上限

export class ThreadsClient {
  constructor(env) {
    if (!env.THREADS_ACCESS_TOKEN) {
      throw new Error("THREADS_ACCESS_TOKEN is not configured");
    }
    this.token = String(env.THREADS_ACCESS_TOKEN).trim();
    // Threads user ID は me() で取れるので env 必須ではない。あれば使う。
    this.userId = env.THREADS_USER_ID ? String(env.THREADS_USER_ID).trim() : null;
    const host = (env.THREADS_HOST || DEFAULT_HOST).replace(/\/$/, "");
    this.base = `${host}/${API_VERSION}`;
  }

  async publishText({ text }) {
    if (!text) throw new Error("text is required");
    if (text.length > TEXT_MAX) throw new Error(`text too long: ${text.length} > ${TEXT_MAX}`);
    const creationId = await this._createContainer({ media_type: "TEXT", text });
    await this._waitContainerReady(creationId, TEXT_TIMEOUT_MS);
    return await this._publishContainer(creationId);
  }

  async publishImage({ image_url, text }) {
    if (!image_url) throw new Error("image_url is required");
    const creationId = await this._createContainer({
      media_type: "IMAGE",
      image_url,
      text: (text || "").slice(0, TEXT_MAX),
    });
    await this._waitContainerReady(creationId, IMAGE_TIMEOUT_MS);
    return await this._publishContainer(creationId);
  }

  async publishVideo({ video_url, text }) {
    if (!video_url) throw new Error("video_url is required");
    const creationId = await this._createContainer({
      media_type: "VIDEO",
      video_url,
      text: (text || "").slice(0, TEXT_MAX),
    });
    await this._waitContainerReady(creationId, VIDEO_TIMEOUT_MS);
    return await this._publishContainer(creationId);
  }

  async publishCarousel({ items, text }) {
    if (!Array.isArray(items) || items.length < 2) {
      throw new Error("carousel requires at least 2 items");
    }
    if (items.length > MAX_CAROUSEL_ITEMS) {
      throw new Error(`carousel supports up to ${MAX_CAROUSEL_ITEMS} items`);
    }
    const childIds = [];
    let hasVideo = false;
    for (const item of items) {
      const params = { is_carousel_item: true };
      if (item.image_url) {
        params.media_type = "IMAGE";
        params.image_url = item.image_url;
      } else if (item.video_url) {
        params.media_type = "VIDEO";
        params.video_url = item.video_url;
        hasVideo = true;
      } else {
        throw new Error("carousel item requires image_url or video_url");
      }
      const cid = await this._createContainer(params);
      if (item.video_url) {
        await this._waitContainerReady(cid, VIDEO_TIMEOUT_MS);
      }
      childIds.push(cid);
    }
    const parentId = await this._createContainer({
      media_type: "CAROUSEL",
      children: childIds.join(","),
      text: (text || "").slice(0, TEXT_MAX),
    });
    await this._waitContainerReady(parentId, hasVideo ? VIDEO_TIMEOUT_MS : IMAGE_TIMEOUT_MS);
    return await this._publishContainer(parentId);
  }

  async _createContainer(params) {
    const url = `${this.base}/${this._userPath()}/threads`;
    const body = new URLSearchParams({ access_token: this.token });
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      body.set(k, typeof v === "boolean" ? String(v) : String(v));
    }
    const res = await fetch(url, { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id) {
      throw new Error(`Threads create container failed: ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
    }
    return data.id;
  }

  async _waitContainerReady(containerId, timeoutMs) {
    const url = `${this.base}/${containerId}?fields=status,error_message&access_token=${encodeURIComponent(this.token)}`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (data.status === "FINISHED") return;
      if (data.status === "ERROR" || data.status === "EXPIRED") {
        throw new Error(`Threads container failed: ${JSON.stringify(data).slice(0, 300)}`);
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error(`Threads container did not finish within ${timeoutMs}ms`);
  }

  async _publishContainer(creationId) {
    const url = `${this.base}/${this._userPath()}/threads_publish`;
    const body = new URLSearchParams({
      creation_id: creationId,
      access_token: this.token,
    });
    const res = await fetch(url, { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id) {
      throw new Error(`Threads publish failed: ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
    }
    return { media_id: data.id };
  }

  _userPath() {
    return this.userId || "me";
  }

  async me() {
    const url = `${this.base}/me?fields=id,username&access_token=${encodeURIComponent(this.token)}`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Threads me() failed: ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
    }
    return data;
  }
}
