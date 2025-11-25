import express from "express";
import {
  login,
  getMe,
  getUserList,
  updateProfile,
  updateUserPermission,
  deleteUser,
  createUserByAdmin,
  adminUpdateUser,
  adminResetPassword,
} from "../controllers/authController.js";
import { protect, authorize } from "../middleware/auth.js";
import { validateLogin } from "../middleware/validation.js";

const router = express.Router();

// 所有接口都使用 POST 方法
router.post("/login", validateLogin, login);
router.post("/me", protect, getMe);
router.post(
  "/user-list",
  protect,
  authorize("超级管理员", "管理员"),
  getUserList
);
router.post("/profile", protect, updateProfile);
router.post(
  "/update-permission",
  protect,
  authorize("超级管理员"),
  updateUserPermission
);
router.post("/delete", protect, authorize("超级管理员"), deleteUser);

// 管理员接口：创建用户（仅超级管理员）
router.post("/create-user", protect, authorize("超级管理员"), createUserByAdmin);

// 管理员修改用户信息（仅超级管理员）
router.post("/admin-update-user", protect, authorize("超级管理员"), adminUpdateUser);

// 管理员重置用户密码（仅超级管理员）
router.post("/reset-password", protect, authorize("超级管理员"), adminResetPassword);

export default router;
