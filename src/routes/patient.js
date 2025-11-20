const express = require("express");
const {
  createPatient,
  getPatientList,
  getPatientDetail,
  updatePatient,
  deletePatient,
  getGroups,
  getStatistics,
} = require("../controllers/patientController");
const { protect, authorize } = require("../middleware/auth");
const {
  validatePatientCreate,
  validatePatientUpdate,
} = require("../middleware/patientValidation");

const router = express.Router();

// 所有病人相关接口都需要登录
router.use(protect);

// 创建病人（需要管理员权限）
router.post(
  "/create",
  authorize("超级管理员", "管理员"),
  validatePatientCreate,
  createPatient
);

// 获取病人列表（所有登录用户都可访问）
router.post("/list", getPatientList);

// 获取病人详情（所有登录用户都可访问）
router.post("/detail", getPatientDetail);

// 更新病人信息（需要管理员权限）
router.post(
  "/update",
  authorize("超级管理员", "管理员"),
  validatePatientUpdate,
  updatePatient
);

// 删除病人（需要超级管理员权限）
router.post("/delete", authorize("超级管理员"), deletePatient);

// 获取分组列表（所有登录用户都可访问）
router.post("/groups", getGroups);

// 获取统计数据（所有登录用户都可访问）
router.post("/statistics", getStatistics);

module.exports = router;
