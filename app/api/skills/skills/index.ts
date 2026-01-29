import type { Skill } from "../skillTypes";

import { skill as articleWritingAndPosting } from "./article-writing-and-posting";
import { skill as competitorAnalysis } from "./competitor-analysis";
import { skill as createBoardDoc } from "./create-board-doc";
import { skill as docx } from "./docx";
import { skill as listTwitterAccounts } from "./list-twitter-accounts";
import { skill as notionIntegration } from "./notion-integration";
import { skill as pdf } from "./pdf";
import { skill as pdfParser } from "./pdf-parser";
import { skill as postToTwitter } from "./post-to-twitter";
import { skill as pptx } from "./pptx";
import { skill as searchQuery } from "./search-query";
import { skill as wechatCompetitorCollection } from "./wechat-competitor-collection";
import { skill as xlsx } from "./xlsx";

export const SKILLS: Skill[] = [
  articleWritingAndPosting,
  competitorAnalysis,
  wechatCompetitorCollection,
  listTwitterAccounts,
  postToTwitter,
  createBoardDoc,
  searchQuery,
  notionIntegration,
  pdf,
  pdfParser,
  docx,
  xlsx,
  pptx,
];
