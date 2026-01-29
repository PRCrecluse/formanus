/**
 * 微信公众号第三方平台集成模块
 * 
 * 复用自 ChristmasTree 项目的核心逻辑，适配 formanus 项目架构
 * 
 * 功能包括：
 * 1. component_verify_ticket 接收与缓存
 * 2. component_access_token 获取与刷新
 * 3. authorizer_access_token 获取与刷新
 * 4. 消息加解密（AES）
 * 5. 文章发布流程（素材上传 -> 草稿 -> 发布）
 */

import { getMongoDb } from "@/lib/mongodb";
import crypto from "crypto";
import { ObjectId } from "mongodb";

// ============================================================================
// 类型定义
// ============================================================================

export interface WechatMpConfig {
  componentAppId: string;
  componentAppSecret: string;
  componentToken: string;
  componentEncodingAesKey: string;
}

export interface WechatMpAccount {
  _id?: ObjectId;
  userId: string;
  provider: "wechat_mp";
  authorizerAppId: string;
  authorizerAccessToken: string;
  authorizerRefreshToken: string;
  expiresAt: Date | null;
  funcInfo?: unknown[];
  profile?: {
    nickName?: string;
    headImg?: string;
    serviceTypeInfo?: unknown;
    verifyTypeInfo?: unknown;
    userName?: string;
    principalName?: string;
    qrcodeUrl?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface ArticleContent {
  title: string;
  author?: string;
  content: string; // HTML 内容
  thumbMediaId: string; // 封面图的 media_id
  contentSourceUrl?: string; // 阅读原文链接
  digest?: string; // 摘要
  showCoverPic?: boolean; // 是否显示封面
  needOpenComment?: boolean; // 是否打开评论
  onlyFansCanComment?: boolean; // 是否仅粉丝可评论
}

// ============================================================================
// 配置获取
// ============================================================================

export function getWechatMpConfig(): WechatMpConfig {
  const componentAppId = (process.env.WECHAT_COMPONENT_APPID ?? "").trim();
  const componentAppSecret = (process.env.WECHAT_COMPONENT_APPSECRET ?? "").trim();
  const componentToken = (process.env.WECHAT_COMPONENT_TOKEN ?? "").trim();
  const componentEncodingAesKey = (process.env.WECHAT_COMPONENT_ENCODING_AES_KEY ?? "").trim();

  if (!componentAppId || !componentAppSecret || !componentToken || !componentEncodingAesKey) {
    throw new Error("Missing WeChat component configuration in environment variables");
  }

  return { componentAppId, componentAppSecret, componentToken, componentEncodingAesKey };
}

// ============================================================================
// 消息加解密 (复用自 ChristmasTree 项目的安全模式实现)
// ============================================================================

/**
 * 微信消息签名验证
 * 复用自 ChristmasTree: 微信扫码关注登录设计.md
 */
export function verifySignature(token: string, timestamp: string, nonce: string, signature: string): boolean {
  const arr = [token, timestamp, nonce].sort();
  const str = arr.join("");
  const hash = crypto.createHash("sha1").update(str).digest("hex");
  return hash === signature;
}

/**
 * 微信消息签名验证（带加密消息）
 */
export function verifyMsgSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
  msgSignature: string
): boolean {
  const arr = [token, timestamp, nonce, encrypt].sort();
  const str = arr.join("");
  const hash = crypto.createHash("sha1").update(str).digest("hex");
  return hash === msgSignature;
}

/**
 * AES 解密微信消息
 * 复用自 ChristmasTree: 微信扫码关注登录设计.md - 安全模式（AES）部分
 */
export function decryptMessage(encodingAesKey: string, encrypt: string): string {
  // EncodingAESKey 是 Base64 编码的 43 位字符串，需要补上 "=" 后解码
  const aesKey = Buffer.from(encodingAesKey + "=", "base64");
  const iv = aesKey.subarray(0, 16);

  const decipher = crypto.createDecipheriv("aes-256-cbc", aesKey, iv);
  decipher.setAutoPadding(false);

  let decrypted = Buffer.concat([decipher.update(Buffer.from(encrypt, "base64")), decipher.final()]);

  // 去除 PKCS7 填充
  const pad = decrypted[decrypted.length - 1];
  if (pad > 0 && pad <= 32) {
    decrypted = decrypted.subarray(0, decrypted.length - pad);
  }

  // 消息格式：random(16) + msgLen(4) + msg + appId
  const msgLen = decrypted.readUInt32BE(16);
  const msg = decrypted.subarray(20, 20 + msgLen).toString("utf-8");

  return msg;
}

/**
 * AES 加密微信消息
 */
export function encryptMessage(encodingAesKey: string, appId: string, message: string): string {
  const aesKey = Buffer.from(encodingAesKey + "=", "base64");
  const iv = aesKey.subarray(0, 16);

  const random = crypto.randomBytes(16);
  const msgBuffer = Buffer.from(message, "utf-8");
  const msgLen = Buffer.alloc(4);
  msgLen.writeUInt32BE(msgBuffer.length, 0);
  const appIdBuffer = Buffer.from(appId, "utf-8");

  let data = Buffer.concat([random, msgLen, msgBuffer, appIdBuffer]);

  // PKCS7 填充
  const blockSize = 32;
  const padLen = blockSize - (data.length % blockSize);
  const pad = Buffer.alloc(padLen, padLen);
  data = Buffer.concat([data, pad]);

  const cipher = crypto.createCipheriv("aes-256-cbc", aesKey, iv);
  cipher.setAutoPadding(false);

  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return encrypted.toString("base64");
}

// ============================================================================
// XML 解析工具
// ============================================================================

/**
 * 简单的 XML 解析（提取指定标签的值）
 */
export function parseXmlValue(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}><!\\[CDATA\\[([^\\]]*?)\\]\\]></${tag}>|<${tag}>([^<]*)</${tag}>`, "i");
  const match = xml.match(regex);
  return match ? (match[1] ?? match[2] ?? "") : "";
}

/**
 * 解析微信推送的 XML 消息
 */
export function parseWechatXml(xml: string): Record<string, string> {
  const tags = [
    "AppId",
    "CreateTime",
    "InfoType",
    "ComponentVerifyTicket",
    "AuthorizerAppid",
    "AuthorizationCode",
    "AuthorizationCodeExpiredTime",
    "PreAuthCode",
    "ToUserName",
    "FromUserName",
    "MsgType",
    "Event",
    "EventKey",
    "Encrypt",
  ];

  const result: Record<string, string> = {};
  for (const tag of tags) {
    const value = parseXmlValue(xml, tag);
    if (value) result[tag] = value;
  }
  return result;
}

// ============================================================================
// Ticket 和 Token 管理 (复用自 ChristmasTree 项目)
// ============================================================================

const TICKET_CACHE_KEY = "wechat:component_verify_ticket";
const COMPONENT_TOKEN_CACHE_KEY = "wechat:component_access_token";

/**
 * 缓存 component_verify_ticket
 * 复用自 ChristmasTree: 微信扫码关注登录设计.md - 数据流说明
 */
export async function cacheComponentVerifyTicket(ticket: string): Promise<void> {
  const db = await getMongoDb();
  const col = db.collection("wechat_cache");
  await col.updateOne(
    { key: TICKET_CACHE_KEY },
    {
      $set: {
        value: ticket,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );
}

/**
 * 获取缓存的 component_verify_ticket
 */
export async function getComponentVerifyTicket(): Promise<string | null> {
  const db = await getMongoDb();
  const col = db.collection("wechat_cache");
  const doc = await col.findOne({ key: TICKET_CACHE_KEY });
  return doc?.value ?? null;
}

/**
 * 获取 component_access_token
 * 复用自 ChristmasTree: 微信扫码关注登录设计.md - 接口能力说明
 * 
 * 请求地址：https://api.weixin.qq.com/cgi-bin/component/api_component_token
 * 参数：component_appid、component_appsecret、component_verify_ticket
 */
export async function getComponentAccessToken(): Promise<string> {
  const config = getWechatMpConfig();
  const db = await getMongoDb();
  const col = db.collection("wechat_cache");

  // 检查缓存
  const cached = await col.findOne({ key: COMPONENT_TOKEN_CACHE_KEY });
  if (cached?.value && cached?.expiresAt && new Date(cached.expiresAt) > new Date()) {
    return cached.value;
  }

  // 获取 ticket
  const ticket = await getComponentVerifyTicket();
  if (!ticket) {
    throw new Error("component_verify_ticket not available, please wait for WeChat to push it");
  }

  // 请求新的 token
  const url = "https://api.weixin.qq.com/cgi-bin/component/api_component_token";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      component_appid: config.componentAppId,
      component_appsecret: config.componentAppSecret,
      component_verify_ticket: ticket,
    }),
  });

  const data = (await res.json()) as {
    component_access_token?: string;
    expires_in?: number;
    errcode?: number;
    errmsg?: string;
  };

  if (!data.component_access_token) {
    throw new Error(`Failed to get component_access_token: ${data.errmsg || "unknown error"}`);
  }

  // 缓存 token（提前 5 分钟过期）
  const expiresAt = new Date(Date.now() + (data.expires_in! - 300) * 1000);
  await col.updateOne(
    { key: COMPONENT_TOKEN_CACHE_KEY },
    {
      $set: {
        value: data.component_access_token,
        expiresAt,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );

  return data.component_access_token;
}

/**
 * 获取预授权码 pre_auth_code
 * 用于生成授权链接
 */
export async function getPreAuthCode(): Promise<string> {
  const config = getWechatMpConfig();
  const componentAccessToken = await getComponentAccessToken();

  const url = `https://api.weixin.qq.com/cgi-bin/component/api_create_preauthcode?component_access_token=${componentAccessToken}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      component_appid: config.componentAppId,
    }),
  });

  const data = (await res.json()) as {
    pre_auth_code?: string;
    expires_in?: number;
    errcode?: number;
    errmsg?: string;
  };

  if (!data.pre_auth_code) {
    throw new Error(`Failed to get pre_auth_code: ${data.errmsg || "unknown error"}`);
  }

  return data.pre_auth_code;
}

/**
 * 生成授权链接
 * 复用自 ChristmasTree: 微信扫码关注登录设计.md - 商户授权链路
 */
export async function generateAuthUrl(redirectUri: string): Promise<string> {
  const config = getWechatMpConfig();
  const preAuthCode = await getPreAuthCode();

  const params = new URLSearchParams({
    component_appid: config.componentAppId,
    pre_auth_code: preAuthCode,
    redirect_uri: redirectUri,
    auth_type: "1", // 1: 仅展示公众号
  });

  return `https://mp.weixin.qq.com/cgi-bin/componentloginpage?${params.toString()}`;
}

/**
 * 使用授权码换取公众号授权信息
 * 复用自 ChristmasTree: 微信扫码关注登录设计.md - 数据流说明第4步
 */
export async function queryAuth(authorizationCode: string): Promise<{
  authorizerAppId: string;
  authorizerAccessToken: string;
  authorizerRefreshToken: string;
  expiresIn: number;
  funcInfo: unknown[];
}> {
  const config = getWechatMpConfig();
  const componentAccessToken = await getComponentAccessToken();

  const url = `https://api.weixin.qq.com/cgi-bin/component/api_query_auth?component_access_token=${componentAccessToken}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      component_appid: config.componentAppId,
      authorization_code: authorizationCode,
    }),
  });

  const data = (await res.json()) as {
    authorization_info?: {
      authorizer_appid: string;
      authorizer_access_token: string;
      expires_in: number;
      authorizer_refresh_token: string;
      func_info: unknown[];
    };
    errcode?: number;
    errmsg?: string;
  };

  if (!data.authorization_info) {
    throw new Error(`Failed to query auth: ${data.errmsg || "unknown error"}`);
  }

  return {
    authorizerAppId: data.authorization_info.authorizer_appid,
    authorizerAccessToken: data.authorization_info.authorizer_access_token,
    authorizerRefreshToken: data.authorization_info.authorizer_refresh_token,
    expiresIn: data.authorization_info.expires_in,
    funcInfo: data.authorization_info.func_info,
  };
}

/**
 * 获取公众号基本信息
 */
export async function getAuthorizerInfo(authorizerAppId: string): Promise<{
  nickName: string;
  headImg: string;
  serviceTypeInfo: unknown;
  verifyTypeInfo: unknown;
  userName: string;
  principalName: string;
  qrcodeUrl: string;
}> {
  const config = getWechatMpConfig();
  const componentAccessToken = await getComponentAccessToken();

  const url = `https://api.weixin.qq.com/cgi-bin/component/api_get_authorizer_info?component_access_token=${componentAccessToken}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      component_appid: config.componentAppId,
      authorizer_appid: authorizerAppId,
    }),
  });

  const data = (await res.json()) as {
    authorizer_info?: {
      nick_name: string;
      head_img: string;
      service_type_info: unknown;
      verify_type_info: unknown;
      user_name: string;
      principal_name: string;
      qrcode_url: string;
    };
    errcode?: number;
    errmsg?: string;
  };

  if (!data.authorizer_info) {
    throw new Error(`Failed to get authorizer info: ${data.errmsg || "unknown error"}`);
  }

  return {
    nickName: data.authorizer_info.nick_name,
    headImg: data.authorizer_info.head_img,
    serviceTypeInfo: data.authorizer_info.service_type_info,
    verifyTypeInfo: data.authorizer_info.verify_type_info,
    userName: data.authorizer_info.user_name,
    principalName: data.authorizer_info.principal_name,
    qrcodeUrl: data.authorizer_info.qrcode_url,
  };
}

/**
 * 刷新公众号授权令牌
 */
export async function refreshAuthorizerToken(
  authorizerAppId: string,
  authorizerRefreshToken: string
): Promise<{
  authorizerAccessToken: string;
  authorizerRefreshToken: string;
  expiresIn: number;
}> {
  const config = getWechatMpConfig();
  const componentAccessToken = await getComponentAccessToken();

  const url = `https://api.weixin.qq.com/cgi-bin/component/api_authorizer_token?component_access_token=${componentAccessToken}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      component_appid: config.componentAppId,
      authorizer_appid: authorizerAppId,
      authorizer_refresh_token: authorizerRefreshToken,
    }),
  });

  const data = (await res.json()) as {
    authorizer_access_token?: string;
    expires_in?: number;
    authorizer_refresh_token?: string;
    errcode?: number;
    errmsg?: string;
  };

  if (!data.authorizer_access_token) {
    throw new Error(`Failed to refresh authorizer token: ${data.errmsg || "unknown error"}`);
  }

  return {
    authorizerAccessToken: data.authorizer_access_token,
    authorizerRefreshToken: data.authorizer_refresh_token || authorizerRefreshToken,
    expiresIn: data.expires_in!,
  };
}

// ============================================================================
// 公众号账号管理
// ============================================================================

/**
 * 保存或更新公众号授权信息
 */
export async function saveWechatMpAccount(
  userId: string,
  authInfo: {
    authorizerAppId: string;
    authorizerAccessToken: string;
    authorizerRefreshToken: string;
    expiresIn: number;
    funcInfo?: unknown[];
    profile?: WechatMpAccount["profile"];
  }
): Promise<void> {
  const db = await getMongoDb();
  const col = db.collection("social_accounts");

  const expiresAt = new Date(Date.now() + (authInfo.expiresIn - 300) * 1000);

  await col.updateOne(
    { userId, provider: "wechat_mp", authorizerAppId: authInfo.authorizerAppId },
    {
      $set: {
        authorizerAccessToken: authInfo.authorizerAccessToken,
        authorizerRefreshToken: authInfo.authorizerRefreshToken,
        expiresAt,
        funcInfo: authInfo.funcInfo,
        profile: authInfo.profile,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        userId,
        provider: "wechat_mp",
        authorizerAppId: authInfo.authorizerAppId,
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );
}

/**
 * 获取用户绑定的公众号列表
 */
export async function getWechatMpAccounts(userId: string): Promise<WechatMpAccount[]> {
  const db = await getMongoDb();
  const col = db.collection("social_accounts");
  const docs = await col.find({ userId, provider: "wechat_mp" }).toArray();
  return docs as unknown as WechatMpAccount[];
}

/**
 * 获取公众号的有效 access_token（自动刷新）
 */
export async function getAuthorizerAccessToken(userId: string, authorizerAppId: string): Promise<string> {
  const db = await getMongoDb();
  const col = db.collection("social_accounts");

  const doc = await col.findOne({ userId, provider: "wechat_mp", authorizerAppId });
  if (!doc) {
    throw new Error("WeChat MP account not found");
  }

  // 检查是否需要刷新
  const expiresAt = doc.expiresAt ? new Date(doc.expiresAt) : null;
  const needsRefresh = !expiresAt || expiresAt.getTime() - Date.now() < 60000;

  if (!needsRefresh && doc.authorizerAccessToken) {
    return doc.authorizerAccessToken;
  }

  // 刷新 token
  const refreshed = await refreshAuthorizerToken(authorizerAppId, doc.authorizerRefreshToken);

  // 更新数据库
  const newExpiresAt = new Date(Date.now() + (refreshed.expiresIn - 300) * 1000);
  await col.updateOne(
    { _id: doc._id },
    {
      $set: {
        authorizerAccessToken: refreshed.authorizerAccessToken,
        authorizerRefreshToken: refreshed.authorizerRefreshToken,
        expiresAt: newExpiresAt,
        updatedAt: new Date(),
      },
    }
  );

  return refreshed.authorizerAccessToken;
}

// ============================================================================
// 文章发布相关接口
// ============================================================================

/**
 * 上传图文消息内的图片（获取微信图片URL）
 * 用于文章内容中的图片
 */
export async function uploadContentImage(
  accessToken: string,
  imageBuffer: Buffer,
  filename: string
): Promise<string> {
  const url = `https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=${accessToken}`;

  const boundary = `----WebKitFormBoundary${crypto.randomBytes(16).toString("hex")}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`
    ),
    imageBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  const data = (await res.json()) as { url?: string; errcode?: number; errmsg?: string };
  if (!data.url) {
    throw new Error(`Failed to upload content image: ${data.errmsg || "unknown error"}`);
  }

  return data.url;
}

/**
 * 上传永久素材（封面图等）
 */
export async function uploadMaterial(
  accessToken: string,
  imageBuffer: Buffer,
  filename: string,
  type: "image" | "voice" | "video" | "thumb" = "image"
): Promise<{ mediaId: string; url?: string }> {
  const url = `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${accessToken}&type=${type}`;

  const boundary = `----WebKitFormBoundary${crypto.randomBytes(16).toString("hex")}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`
    ),
    imageBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  const data = (await res.json()) as { media_id?: string; url?: string; errcode?: number; errmsg?: string };
  if (!data.media_id) {
    throw new Error(`Failed to upload material: ${data.errmsg || "unknown error"}`);
  }

  return { mediaId: data.media_id, url: data.url };
}

/**
 * 新建草稿
 */
export async function addDraft(accessToken: string, articles: ArticleContent[]): Promise<string> {
  const url = `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${accessToken}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      articles: articles.map((a) => ({
        title: a.title,
        author: a.author || "",
        digest: a.digest || "",
        content: a.content,
        content_source_url: a.contentSourceUrl || "",
        thumb_media_id: a.thumbMediaId,
        show_cover_pic: a.showCoverPic ? 1 : 0,
        need_open_comment: a.needOpenComment ? 1 : 0,
        only_fans_can_comment: a.onlyFansCanComment ? 1 : 0,
      })),
    }),
  });

  const data = (await res.json()) as { media_id?: string; errcode?: number; errmsg?: string };
  if (!data.media_id) {
    throw new Error(`Failed to add draft: ${data.errmsg || "unknown error"}`);
  }

  return data.media_id;
}

/**
 * 发布草稿
 */
export async function submitPublish(accessToken: string, mediaId: string): Promise<string> {
  const url = `https://api.weixin.qq.com/cgi-bin/freepublish/submit?access_token=${accessToken}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_id: mediaId }),
  });

  const data = (await res.json()) as { publish_id?: string; errcode?: number; errmsg?: string };
  if (!data.publish_id) {
    throw new Error(`Failed to submit publish: ${data.errmsg || "unknown error"}`);
  }

  return data.publish_id;
}

/**
 * 查询发布状态
 */
export async function getPublishStatus(
  accessToken: string,
  publishId: string
): Promise<{
  publishStatus: number; // 0: 成功, 1: 发布中, 2+: 失败
  articleId?: string;
  articleUrl?: string;
  failIdx?: number[];
}> {
  const url = `https://api.weixin.qq.com/cgi-bin/freepublish/get?access_token=${accessToken}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publish_id: publishId }),
  });

  const data = (await res.json()) as {
    publish_id?: string;
    publish_status?: number;
    article_id?: string;
    article_detail?: {
      count?: number;
      item?: Array<{ idx?: number; article_url?: string }>;
    };
    fail_idx?: number[];
    errcode?: number;
    errmsg?: string;
  };

  if (data.errcode && data.errcode !== 0) {
    throw new Error(`Failed to get publish status: ${data.errmsg || "unknown error"}`);
  }

  return {
    publishStatus: data.publish_status ?? -1,
    articleId: data.article_id,
    articleUrl: data.article_detail?.item?.[0]?.article_url,
    failIdx: data.fail_idx,
  };
}

// ============================================================================
// 高级封装：一键发布文章
// ============================================================================

/**
 * 完整的文章发布流程
 * 1. 创建草稿
 * 2. 提交发布
 * 3. 轮询发布状态
 */
export async function publishArticle(
  userId: string,
  authorizerAppId: string,
  article: ArticleContent,
  options?: {
    maxWaitMs?: number;
    pollIntervalMs?: number;
  }
): Promise<{
  ok: boolean;
  publishId?: string;
  articleId?: string;
  articleUrl?: string;
  error?: string;
}> {
  const maxWaitMs = options?.maxWaitMs ?? 60000;
  const pollIntervalMs = options?.pollIntervalMs ?? 3000;

  try {
    // 获取有效的 access_token
    const accessToken = await getAuthorizerAccessToken(userId, authorizerAppId);

    // 创建草稿
    const draftMediaId = await addDraft(accessToken, [article]);
    console.log(`[wechat-mp] Draft created: ${draftMediaId}`);

    // 提交发布
    const publishId = await submitPublish(accessToken, draftMediaId);
    console.log(`[wechat-mp] Publish submitted: ${publishId}`);

    // 轮询发布状态
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

      const status = await getPublishStatus(accessToken, publishId);
      console.log(`[wechat-mp] Publish status: ${status.publishStatus}`);

      if (status.publishStatus === 0) {
        return {
          ok: true,
          publishId,
          articleId: status.articleId,
          articleUrl: status.articleUrl,
        };
      } else if (status.publishStatus >= 2) {
        return {
          ok: false,
          publishId,
          error: `Publish failed with status ${status.publishStatus}, fail_idx: ${status.failIdx?.join(",")}`,
        };
      }
      // status === 1 表示发布中，继续轮询
    }

    return {
      ok: false,
      publishId,
      error: "Publish timeout",
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return { ok: false, error: message };
  }
}

/**
 * 为用户发布文章到指定公众号
 * 对外暴露的主要接口，类似于 postToXForUser
 */
export async function postToWechatMpForUser(args: {
  userId: string;
  authorizerAppId?: string;
  article: ArticleContent;
}): Promise<{
  ok: boolean;
  publishId?: string;
  articleId?: string;
  articleUrl?: string;
  error?: string;
}> {
  const { userId, article } = args;

  // 获取用户绑定的公众号
  const accounts = await getWechatMpAccounts(userId);
  if (accounts.length === 0) {
    return { ok: false, error: "No WeChat MP account connected" };
  }

  // 如果指定了 appId，使用指定的；否则使用第一个
  const targetAppId = args.authorizerAppId || accounts[0].authorizerAppId;
  const account = accounts.find((a) => a.authorizerAppId === targetAppId);
  if (!account) {
    return { ok: false, error: "Specified WeChat MP account not found" };
  }

  return publishArticle(userId, targetAppId, article);
}
