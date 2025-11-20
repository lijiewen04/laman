const express = require("express");
const multer = require("multer");
const path = require("path");
const {
  uploadFile,
  downloadFile,
  getFileList,
  getFilePreview,
  deleteFile,
  getFileTypes,
  authorizeDownload,
} = require("../controllers/fileController");
const { protect, authorize } = require("../middleware/auth");
const {
  validateFileUpload,
  validateDownloadAuth,
} = require("../middleware/fileValidation");

const router = express.Router();

// 配置 multer 用于文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "../../uploads");
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // 生成唯一文件名：时间戳 + 随机数 + 原扩展名
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, "file-" + uniqueSuffix + ext);
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
  },
  fileFilter: (req, file, cb) => {
    // 允许所有文件类型，因为我们会在控制器中检测
    cb(null, true);
  },
});

// 所有文件接口都需要登录
router.use(protect);

// 文件上传（管理员和超级管理员）
router.post(
  "/upload",
  authorize("超级管理员", "管理员"),
  upload.single("file"),
  validateFileUpload,
  uploadFile
);

// 文件下载（所有有权限的用户）
router.post("/download", downloadFile);

// 获取文件列表（所有登录用户都可访问）
router.post("/list", getFileList);

// 获取文件预览（所有登录用户都可访问）
router.post("/preview", getFilePreview);

// 获取文件类型列表（所有登录用户都可访问）
router.post("/types", getFileTypes);

// 删除文件（仅超级管理员）
router.post("/delete", authorize("超级管理员"), deleteFile);

// 授权访客下载（仅超级管理员）
router.post(
  "/authorize-download",
  authorize("超级管理员"),
  validateDownloadAuth,
  authorizeDownload
);

module.exports = router;
