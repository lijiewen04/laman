const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const fileRoutes = require("./routes/file");
require("dotenv").config();

// 导入数据库连接（会自动初始化）
require("./database/duckdb");

const authRoutes = require("./routes/auth");
const patientRoutes = require("./routes/patient");
const { createResponse } = require("./middleware/auth");

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
