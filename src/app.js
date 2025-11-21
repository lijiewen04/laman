import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import fileRoutes from "./routes/file.js";
// 导入数据库连接（会自动初始化）
import "./database/duckdb.js";
import authRoutes from "./routes/auth.js";
import patientRoutes from "./routes/patient.js";
import { createResponse } from "./middleware/auth.js";
import swaggerUi from "swagger-ui-express";
import fs from "fs";
import path from "path";

dotenv.config();

const app = express();

// 中间件
app.use(helmet());
app.use(cors());
app.use(morgan("combined"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 路由
app.use("/api/auth", authRoutes);
app.use("/api/patient", patientRoutes);
app.use("/api/file", fileRoutes);
// 挂载 Swagger UI（如果存在 swagger.json）
try {
  const swaggerPath = path.resolve("./src/swagger.json");
  if (fs.existsSync(swaggerPath)) {
    const swaggerDocument = JSON.parse(fs.readFileSync(swaggerPath, "utf8"));
    app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  }
} catch (e) {
  console.warn("无法加载 Swagger 文档:", e.message);
}
// 健康检查路由（也使用POST）
app.post("/health", (req, res) => {
  res.json(
    createResponse(0, "服务运行正常", {
      timestamp: new Date().toISOString(),
      database: "DuckDB",
    })
  );
});

// 404处理
app.use("*", (req, res) => {
  res.json(createResponse(4001, "路由不存在"));
});

// 全局错误处理
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.json(createResponse(5001, "服务器内部错误"));
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
  console.log(`环境: ${process.env.NODE_ENV}`);
  console.log(`数据库: DuckDB (${process.env.DATABASE_PATH})`);
  console.log("所有接口使用POST方法，响应格式: {status, msg, data}");
});
