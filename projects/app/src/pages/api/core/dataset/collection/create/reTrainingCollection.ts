import { type reTrainingDatasetFileCollectionParams } from '@fastgpt/global/core/dataset/api';
import { createCollectionAndInsertData } from '@fastgpt/service/core/dataset/collection/controller';
import {
  DatasetCollectionTypeEnum,
  DatasetSourceReadTypeEnum
} from '@fastgpt/global/core/dataset/constants';
import { mongoSessionRun } from '@fastgpt/service/common/mongo/sessionRun';
import { hashStr } from '@fastgpt/global/common/string/tools';
import { readDatasetSourceRawText } from '@fastgpt/service/core/dataset/read';
import { NextAPI } from '@/service/middleware/entry';
import { type ApiRequestProps } from '@fastgpt/service/type/next';
import { delCollection } from '@fastgpt/service/core/dataset/collection/controller';
import { authDatasetCollection } from '@fastgpt/service/support/permission/dataset/auth';
import { CommonErrEnum } from '@fastgpt/global/common/error/code/common';
import { i18nT } from '@fastgpt/web/i18n/utils';
import { WritePermissionVal } from '@fastgpt/global/support/permission/constant';
import { addOperationLog } from '@fastgpt/service/support/operationLog/addOperationLog';
import { OperationLogEventEnum } from '@fastgpt/global/support/operationLog/constants';
import { getI18nDatasetType } from '@fastgpt/service/support/operationLog/util';

type RetrainingCollectionResponse = {
  collectionId: string;
};

// 获取集合并处理
async function handler(
  req: ApiRequestProps<reTrainingDatasetFileCollectionParams>
): Promise<RetrainingCollectionResponse> {
  const { collectionId, customPdfParse, ...data } = req.body;

  if (!collectionId) {
    return Promise.reject(CommonErrEnum.missingParams);
  }

  // 凭证校验
  const { collection, teamId, tmbId } = await authDatasetCollection({
    req,
    authToken: true,
    authApiKey: true,
    collectionId: collectionId,
    per: WritePermissionVal
  });

  const sourceReadType = await (async () => {
    if (collection.type === DatasetCollectionTypeEnum.link) {
      if (!collection.rawLink) return Promise.reject('rawLink is missing');
      return {
        type: DatasetSourceReadTypeEnum.link,
        sourceId: collection.rawLink,
        selector: collection.metadata?.webPageSelector
      };
    }
    if (collection.type === DatasetCollectionTypeEnum.file) {
      if (!collection.fileId) return Promise.reject('fileId is missing');
      return {
        type: DatasetSourceReadTypeEnum.fileLocal,
        sourceId: String(collection.fileId)
      };
    }
    if (collection.type === DatasetCollectionTypeEnum.apiFile) {
      if (!collection.apiFileId) return Promise.reject('apiFileId is missing');
      return {
        type: DatasetSourceReadTypeEnum.apiFile,
        sourceId: collection.apiFileId,
        apiServer: collection.dataset.apiServer,
        feishuServer: collection.dataset.feishuServer,
        yuqueServer: collection.dataset.yuqueServer
      };
    }
    if (collection.type === DatasetCollectionTypeEnum.externalFile) {
      if (!collection.externalFileUrl) return Promise.reject('externalFileId is missing');
      return {
        type: DatasetSourceReadTypeEnum.externalFile,
        sourceId: collection.externalFileUrl,
        externalFileId: collection.externalFileId
      };
    }

    return Promise.reject(i18nT('dataset:collection_not_support_retraining'));
  })();

  const { title, rawText } = await readDatasetSourceRawText({
    teamId,
    tmbId,
    customPdfParse,
    ...sourceReadType
  });

  return mongoSessionRun(async (session) => {
    await delCollection({
      collections: [collection],
      session,
      delImg: false,
      delFile: false
    });

    const { collectionId } = await createCollectionAndInsertData({
      dataset: collection.dataset,
      rawText,
      relatedId: collection.metadata?.relatedImgId,
      createCollectionParams: {
        ...data,
        teamId: collection.teamId,
        tmbId: collection.tmbId,
        datasetId: collection.dataset._id,
        name: title || collection.name,
        type: collection.type,

        customPdfParse,

        fileId: collection.fileId,
        rawLink: collection.rawLink,
        externalFileId: collection.externalFileId,
        externalFileUrl: collection.externalFileUrl,
        apiFileId: collection.apiFileId,

        hashRawText: hashStr(rawText),
        rawTextLength: rawText.length,

        tags: collection.tags,
        createTime: collection.createTime,

        parentId: collection.parentId,

        // special metadata
        metadata: collection.metadata
      }
    });

    (async () => {
      addOperationLog({
        tmbId,
        teamId,
        event: OperationLogEventEnum.RETRAIN_COLLECTION,
        params: {
          collectionName: collection.name,
          datasetName: collection.dataset?.name || '',
          datasetType: getI18nDatasetType(collection.dataset?.type || '')
        }
      });
    })();

    return { collectionId };
  });
}

export default NextAPI(handler);
