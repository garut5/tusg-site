// Instagram Graph API - Content Publishing クライアント
//
// 参考: https://developers.facebook.com/docs/instagram-platform/content-publishing
//
// 2-step で 1 投稿:
//   1. POST /{ig-user-id}/media       → creation_id 取得
//   2. POST /{ig-user-id}/media_publish → 実際に公開
//
// カルーセル (複数画像) は 3-step:
//   1. 各画像を POST /media (is_carousel_item=true) → item_ids
//   2. POST /media (children=[item_ids], media_type=CAROUSEL) → creation_id
//   3. POST /media_publish
//
// 使い方:
//   const ig = new InstagramClient(env);
//   const result = await ig.publishSingle({ image_url, caption });
//   const result = await ig.publishCarousel({ image_urls: [...], caption });

// Instagram Business Login (ig_biz_login_oauth) 経由で発行されたトークンは
// graph.instagram.com で使用。Facebook Login 経由なら graph.facebook.com。
// 環境変数 INSTAGRAM_GRAPH_HOST で切替可能 (default: graph.instagram.com)。
const DEFAULT_GRAPH_HOST = "https://graph.instagram.com";
const FACEBOOK_GRAPH_HOST = "https://graph.facebook.com";
const GRAPH_API_VERSION = "v21.0";
const MAX_CAROUSEL_ITEMS = 10;
const MEDIA_PROCESS_POLL_INTERVAL_MS = 2000;
const MEDIA_PROCESS_TIMEOUT_MS = 60000;

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
    // graph.instagram.com では /me/... で self-reference。
    // graph.facebook.com では /{ig-business-account-id}/... を指定。
    this.selfPath = this.isFacebookHost ? `/${this.igUserId}` : "/me";
  }

  async publishSingle({ image_url, caption }) {
    if (!image_url) throw new Error("image_url is required");
    const creationId = await this._createContainer({
      image_url,
      caption: caption || "",
    });
    await this._waitContainerReady(creationId);
    return await this._publishContainer(creationId);
  }

  async publishCarousel({ image_urls, caption }) {
    if (!Array.isArray(image_urls) || image_urls.length < 2) {
      throw new Error("carousel requires at least 2 image_urls");
    }
    if (image_urls.length > MAX_CAROUSEL_ITEMS) {
      throw new Error(`carousel supports up to ${MAX_CAROUSEL_ITEMS} images`);
    }
    const itemIds = [];
    for (const url of image_urls) {
      const itemId = await this._createContainer({
        image_url: url,
        is_carousel_item: true,
      });
      itemIds.push(itemId);
    }
    const carouselId = await this._createContainer({
      media_type: "CAROUSEL",
      children: itemIds.join(","),
      caption: caption || "",
    });
    await this._waitContainerReady(carouselId);
    return await this._publishContainer(carouselId);
  }

  async _createContainer(params) {
    const url = `${this.base}${this.selfPath}/media`;
    const body = new URLSearchParams({ access_token: this.token });
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") body.set(k, String(v));
    }
    const res = await fetch(url, { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id) {
      throw new Error(`IG create container failed: ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
    }
    return data.id;
  }

  async _waitContainerReady(containerId) {
    const url = `${this.base}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(this.token)}`;
    const deadline = Date.now() + MEDIA_PROCESS_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (data.status_code === "FINISHED") return;
      if (data.status_code === "ERROR" || data.status_code === "EXPIRED") {
        throw new Error(`IG container failed: ${JSON.stringify(data).slice(0, 300)}`);
      }
      await new Promise((r) => setTimeout(r, MEDIA_PROCESS_POLL_INTERVAL_MS));
    }
    throw new Error(`IG container did not finish within ${MEDIA_PROCESS_TIMEOUT_MS}ms`);
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
