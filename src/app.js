import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import fileRoutes from "./routes/file.js";
// 导入数据库连接（会自动初始化）
import database, { closeDatabase } from "./database/duckdb.js";
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
      timestamp: Math.floor(Date.now() / 1000),
    })
  );
});

// 404处理
app.use("*", (req, res) => {
  res.status(200).json(createResponse(4001, "路由不存在"));
});

// 专门处理 JSON 解析错误（来自 express.json / body-parser）
app.use((err, req, res, next) => {
  // express.json 在解析失败时会产生 SyntaxError，且通常包含 `status` 为 400
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    console.warn("JSON 解析错误：", err.message);
    return res.status(200).json(createResponse(4000, "无效的 JSON 格式"));
  }
  // 其他非 JSON 错误传给下一个错误处理中间件
  next(err);
});

// 全局错误处理
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(404).json(createResponse(5001, "服务器内部错误"));
});

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
  console.log(`环境: ${process.env.NODE_ENV}`);
  console.log(`数据库: DuckDB (${process.env.DATABASE_PATH})`);
  console.log("所有接口使用POST方法，响应格式: {status, msg, data}");
});

// 优雅退出处理
async function gracefulShutdown(signal) {
  try {
    console.log(`收到 ${signal}，正在优雅关闭...`);

    // 停止接收新连接
    if (server && typeof server.close === "function") {
      server.close(async (err) => {
        if (err) {
          console.error("关闭服务器时出错:", err);
          process.exit(1);
        }
        // 关闭数据库连接（如果可用）
        try {
          if (closeDatabase && typeof closeDatabase === "function") {
            await closeDatabase();
          } else if (database && typeof database.close === "function") {
            await database.close();
          }
        } catch (e) {
          console.error("关闭资源时出错:", e);
        }
        console.log("优雅关闭完成，退出进程");
        process.exit(0);
      });
    } else {
      process.exit(0);
    }

    // 如果在超时时间内未能退出，强制退出
    setTimeout(() => {
      console.warn("强制退出");
      process.exit(1);
    }, 10000).unref();
  } catch (e) {
    console.error("优雅关闭失败:", e);
    process.exit(1);
  }
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("uncaughtException", (err) => {
  console.error("未捕获异常:", err);
  gracefulShutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  console.error("未处理的 Promise 拒绝:", reason);
  gracefulShutdown("unhandledRejection");
});
