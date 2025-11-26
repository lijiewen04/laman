import { createResponse } from "./auth.js";

export const validateFileUpload = (req, res, next) => {
  if (!req.file) {
    return res.json(createResponse(4001, "请选择要上传的文件"));
  }

  // 检查文件大小（限制为 100MB）
  const maxSize = 100 * 1024 * 1024;
  if (req.file.size > maxSize) {
    return res.json(createResponse(4009, "文件大小不能超过 100MB"));
  }

  // 检查文件类型（可选）
  // 仅允许 CSV 文件上传：校验 MIME 类型 和 文件扩展名
  const allowedMimeTypes = ["text/csv", "application/csv", "application/vnd.ms-excel"];
  const originalName = req.file.originalname || "";
  const ext = originalName.slice(originalName.lastIndexOf('.')).toLowerCase();

  const isMimeOk = allowedMimeTypes.includes(req.file.mimetype);
  const isExtOk = ext === ".csv";

  if (!(isMimeOk && isExtOk)) {
    return res.json(createResponse(4010, "仅支持 CSV 文件上传"));
  }

  next();
};

export const validateDownloadAuth = (req, res, next) => {
  const { fileId, userId, expiresIn, requestId, action } = req.body;

  // 两种合法方式：
  // 1) 直接为用户授权：需要 fileId + userId
  // 2) 处理访客的申请：需要 requestId + action (approve|reject)

  if (requestId !== undefined && requestId !== null) {
    if (!action || (action !== "approve" && action !== "reject")) {
      return res.json(createResponse(4001, "当使用 requestId 时，必须提供 action，取值为 'approve' 或 'reject'"));
    }
    return next();
  }

  if (!fileId || (userId === undefined || userId === null)) {
    return res.json(createResponse(4001, "文件ID和用户ID不能为空"));
  }

  if (isNaN(Number(userId))) {
    return res.json(createResponse(4002, "userId 必须为数字"));
  }

  if (expiresIn && (isNaN(expiresIn) || expiresIn <= 0)) {
    return res.json(createResponse(4011, "授权有效期必须为正数"));
  }

  next();
};

// exports are already declared inline above
