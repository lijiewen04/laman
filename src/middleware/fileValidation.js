const { createResponse } = require("./auth");

const validateFileUpload = (req, res, next) => {
  if (!req.file) {
    return res.json(createResponse(4001, "请选择要上传的文件"));
  }

  // 检查文件大小（限制为 100MB）
  const maxSize = 100 * 1024 * 1024;
  if (req.file.size > maxSize) {
    return res.json(createResponse(4009, "文件大小不能超过 100MB"));
  }

  // 检查文件类型（可选）
  const allowedMimeTypes = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
  ];

  if (!allowedMimeTypes.includes(req.file.mimetype)) {
    return res.json(createResponse(4010, "不支持的文件类型"));
  }

  next();
};

const validateDownloadAuth = (req, res, next) => {
  const { fileId, username, expiresIn } = req.body;

  if (!fileId || !username) {
    return res.json(createResponse(4001, "文件ID和用户名不能为空"));
  }

  if (expiresIn && (isNaN(expiresIn) || expiresIn <= 0)) {
    return res.json(createResponse(4011, "授权有效期必须为正数"));
  }

  next();
};

module.exports = {
  validateFileUpload,
  validateDownloadAuth,
};
