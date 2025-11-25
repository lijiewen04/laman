import db from "../database/duckdb.js";

class PatientService {
  // 辅助：把可能的字符串/数字/布尔值解析成布尔或 null
  toBoolean(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v === 1 || v === 1.0;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (["1", "true", "t", "yes", "y"].includes(s)) return true;
      if (["0", "false", "f", "no", "n"].includes(s)) return false;
      return null;
    }
    return null;
  }

  // 创建病人
  async createPatient(patientData, createdBy) {
    const {
      abbr,
      time,
      name,
      serialNo,
      inpatientOutpatient,
      group,
      gender,
      age,
      caseNo,
      diagnosis,
      isTested,
      tStage,
      nStage,
      mStage,
      stage,
      preTreatment: preTreatmentRaw,
      treatmentType,
      memo,
    } = patientData;

    const preTreatment = this.toBoolean(preTreatmentRaw);

    const inserted = await db.get(
      `INSERT INTO patients (
        abbr, time, name, serialNo, inpatientOutpatient, "group",
        gender, age, caseNo, diagnosis, isTested, tStage, nStage,
        mStage, stage, preTreatment, treatmentType, memo, createdBy
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        abbr,
        time,
        name,
        serialNo,
        inpatientOutpatient,
        group,
        gender,
        age,
        caseNo,
        diagnosis,
        isTested,
        tStage,
        nStage,
        mStage,
        stage,
        preTreatment,
        treatmentType,
        memo,
        createdBy,
      ].map((v) => (v === undefined ? null : v))
    );

    const patient = await this.getPatientById(inserted.id);
    return patient;
  }

  // 根据ID获取病人
  async getPatientById(id) {
    return await db.get(
      `SELECT 
        id, abbr, time, name, serialNo, inpatientOutpatient, "group",
        gender, age, caseNo, diagnosis, isTested, tStage, nStage, mStage, stage,
        preTreatment, treatmentType, memo
       FROM patients WHERE id = ?`,
      [id]
    );
  }

  // 根据流水号获取病人
  async getPatientBySerialNo(serialNo) {
    return await db.get(
      `SELECT 
        id, abbr, time, name, serialNo, inpatientOutpatient, "group",
        gender, age, caseNo, diagnosis, isTested, tStage, nStage, mStage, stage,
        preTreatment, treatmentType, memo
       FROM patients WHERE serialNo = ?`,
      [serialNo]
    );
  }

  // 获取所有病人列表（支持分页和筛选）
  async getPatients(filter = {}, page = 1, limit = 20) {
    let whereClause = "WHERE 1=1";
    const params = [];
    let paramIndex = 1;

    // 构建筛选条件
    if (filter.name) {
      whereClause += ` AND name LIKE ?`;
      params.push(`%${filter.name}%`);
      paramIndex++;
    }

    if (filter.serialNo) {
      whereClause += ` AND serialNo LIKE ?`;
      params.push(`%${filter.serialNo}%`);
      paramIndex++;
    }

    if (filter.inpatientOutpatient) {
      whereClause += ` AND inpatientOutpatient = ?`;
      params.push(filter.inpatientOutpatient);
      paramIndex++;
    }

    if (filter.isTested !== undefined) {
      whereClause += ` AND isTested = ?`;
      params.push(filter.isTested);
      paramIndex++;
    }

    if (filter.diagnosis) {
      whereClause += ` AND diagnosis LIKE ?`;
      params.push(`%${filter.diagnosis}%`);
      paramIndex++;
    }

    if (filter.group) {
      whereClause += ` AND "group" = ?`;
      params.push(filter.group);
      paramIndex++;
    }

    if (filter.abbr) {
      whereClause += ` AND abbr LIKE ?`;
      params.push(`%${filter.abbr}%`);
      paramIndex++;
    }

    if (filter.timeStart) {
      whereClause += ` AND time >= ?`;
      params.push(filter.timeStart);
      paramIndex++;
    }

    if (filter.timeEnd) {
      whereClause += ` AND time <= ?`;
      params.push(filter.timeEnd);
      paramIndex++;
    }

    if (filter.gender) {
      whereClause += ` AND gender = ?`;
      params.push(filter.gender);
      paramIndex++;
    }

    if (filter.ageMin !== undefined) {
      whereClause += ` AND age >= ?`;
      params.push(filter.ageMin);
      paramIndex++;
    }

    if (filter.ageMax !== undefined) {
      whereClause += ` AND age <= ?`;
      params.push(filter.ageMax);
      paramIndex++;
    }

    if (filter.caseNo) {
      whereClause += ` AND caseNo LIKE ?`;
      params.push(`%${filter.caseNo}%`);
      paramIndex++;
    }

    if (filter.tStage) {
      whereClause += ` AND tStage = ?`;
      params.push(filter.tStage);
      paramIndex++;
    }

    if (filter.nStage) {
      whereClause += ` AND nStage = ?`;
      params.push(filter.nStage);
      paramIndex++;
    }

    if (filter.mStage) {
      whereClause += ` AND mStage = ?`;
      params.push(filter.mStage);
      paramIndex++;
    }

    if (filter.stage) {
      whereClause += ` AND stage = ?`;
      params.push(filter.stage);
      paramIndex++;
    }

    if (filter.preTreatment !== undefined && filter.preTreatment !== null) {
      whereClause += ` AND preTreatment = ?`;
      params.push(filter.preTreatment);
      paramIndex++;
    }

    if (filter.treatmentType) {
      whereClause += ` AND treatmentType = ?`;
      params.push(filter.treatmentType);
      paramIndex++;
    }

    if (filter.memo) {
      whereClause += ` AND memo LIKE ?`;
      params.push(`%${filter.memo}%`);
      paramIndex++;
    }

    if (filter.createdBy !== undefined) {
      whereClause += ` AND createdBy = ?`;
      params.push(Number(filter.createdBy));
      paramIndex++;
    }

    // 计算分页
    const offset = (page - 1) * limit;

    // 获取总数（DuckDB 可能返回 BigInt）
    const countResult = await db.get(
      `SELECT COUNT(*) as total FROM patients ${whereClause}`,
      params
    );
    // 将可能的 BigInt 转为 Number，以免与普通 Number 混合运算时报错
    const total = typeof countResult.total === "bigint" ? Number(countResult.total) : countResult.total;

    // 获取数据
    const patients = await db.all(
      `SELECT 
        id, abbr, time, name, serialNo, inpatientOutpatient, "group",
        gender, age, caseNo, diagnosis, isTested, tStage, nStage, mStage, stage,
        preTreatment, treatmentType, memo
       FROM patients 
       ${whereClause}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return {
      patients,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // 更新病人信息
  async updatePatient(id, updateData) {
    // 只更新请求中明确提供的字段，未提供的字段保持不变（即不写入 NULL）
    const fieldsMap = {
      abbr: "abbr",
      time: "time",
      name: "name",
      serialNo: "serialNo",
      inpatientOutpatient: "inpatientOutpatient",
      group: '"group"',
      gender: "gender",
      age: "age",
      caseNo: "caseNo",
      diagnosis: "diagnosis",
      isTested: "isTested",
      tStage: "tStage",
      nStage: "nStage",
      mStage: "mStage",
      stage: "stage",
      preTreatment: "preTreatment",
      treatmentType: "treatmentType",
      memo: "memo",
    };

    const setClauses = [];
    const params = [];

    for (const [key, col] of Object.entries(fieldsMap)) {
      if (Object.prototype.hasOwnProperty.call(updateData, key)) {
      setClauses.push(`${col} = ?`);
      const v = updateData[key];
      params.push(v === undefined ? null : v);
      }
    }

    if (setClauses.length === 0) {
      // 没有要更新的字段，直接返回当前数据
      return await this.getPatientById(id);
    }

    // 添加更新时间
    setClauses.push("updatedAt = CURRENT_TIMESTAMP");

    const sql = `UPDATE patients SET ${setClauses.join(", ")} WHERE id = ?`;
    params.push(id);

    await db.run(sql, params);

    return await this.getPatientById(id);
  }

  // 删除病人
  async deletePatient(id) {
    const result = await db.run("DELETE FROM patients WHERE id = ?", [id]);
    return result.changes > 0;
  }

  // 不再使用 last_insert_rowid(); 使用 INSERT ... RETURNING 获取插入 id

  // 检查流水号是否存在
  async checkSerialNoExists(serialNo, excludeId = null) {
    let sql = "SELECT id FROM patients WHERE serialNo = ?";
    const params = [serialNo];

    if (excludeId) {
      sql += " AND id != ?";
      params.push(excludeId);
    }

    const existingPatient = await db.get(sql, params);
    return existingPatient !== null;
  }

  // 获取分组列表
  async getGroups() {
    const groups = await db.all(
      'SELECT DISTINCT "group" FROM patients WHERE "group" IS NOT NULL ORDER BY "group"'
    );
    return groups.map((g) => g.group);
  }

  // 获取统计数据
  async getStatistics() {
    const stats = await db.all(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN isTested = true THEN 1 END) as tested,
        COUNT(CASE WHEN inpatientOutpatient = '住院' THEN 1 END) as inpatient,
        COUNT(CASE WHEN inpatientOutpatient = '门诊' THEN 1 END) as outpatient
      FROM patients
    `);
    return stats[0];
  }
}

export default new PatientService();
