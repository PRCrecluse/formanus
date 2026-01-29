/**
 * 发布文章到微信公众号的 Skill
 * 
 * 类似于 post-to-twitter skill，提供统一的调用接口
 */

import type { Skill } from "../../skillTypes";
import { postToWechatMpForUser, ArticleContent } from "@/lib/integrations/wechat-mp";

interface PostToWechatInput {
  authorizerAppId?: string;
  title: string;
  author?: string;
  content: string;
  thumbMediaId: string;
  contentSourceUrl?: string;
  digest?: string;
  showCoverPic?: boolean;
}

export const skill: Skill = {
  id: "post-to-wechat",
  name: "Post to WeChat MP",
  description: "Publishes an article to a WeChat Official Account (公众号).",
  category: "integration",
  getStatus: () => {
    // 检查是否配置了微信第三方平台
    const hasConfig = !!(
      process.env.WECHAT_COMPONENT_APPID &&
      process.env.WECHAT_COMPONENT_APPSECRET &&
      process.env.WECHAT_COMPONENT_TOKEN &&
      process.env.WECHAT_COMPONENT_ENCODING_AES_KEY
    );
    return hasConfig ? "ready" : "needs_config";
  },
  run: async ({ input, context }) => {
    const data = (input ?? {}) as PostToWechatInput;

    // 验证必填字段
    if (!data.title) {
      return { ok: false, error: "title is required" };
    }
    if (!data.content) {
      return { ok: false, error: "content is required" };
    }
    if (!data.thumbMediaId) {
      return { ok: false, error: "thumbMediaId is required (upload cover image first)" };
    }

    // 构建文章内容
    const article: ArticleContent = {
      title: data.title,
      author: data.author,
      content: data.content,
      thumbMediaId: data.thumbMediaId,
      contentSourceUrl: data.contentSourceUrl,
      digest: data.digest,
      showCoverPic: data.showCoverPic ?? true,
    };

    // 发布文章
    const result = await postToWechatMpForUser({
      userId: context.userId,
      authorizerAppId: data.authorizerAppId,
      article,
    });

    if (result.ok) {
      return {
        ok: true,
        output: {
          publishId: result.publishId,
          articleId: result.articleId,
          articleUrl: result.articleUrl,
        },
      };
    } else {
      return {
        ok: false,
        error: result.error || "Publish failed",
      };
    }
  },
};
