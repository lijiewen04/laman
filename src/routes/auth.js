import express from "express";
import {
  register,
  login,
  getMe,
  getUserList,
  updateProfile,
  updateUserPermission,
  deleteUser,
} from "../controllers/authController.js";
import { protect, authorize } from "../middleware/auth.js";
import { validateRegister, validateLogin } from "../middleware/validation.js";

const router = express.Router();

// 所有接口都使用 POST 方法
router.post("/register", validateRegister, register);
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

export default router;
