/**
 * 基础使用示例：初始化客户端 → 定义 Schema/Model → 完整 CRUD 流程
 *
 * 运行前请设置环境变量：
 *   export APP_ID=cli_xxx
 *   export APP_SECRET=xxx
 *   export APP_TOKEN=bascnxxx
 *   export TABLE_ID=tblxxx
 */

import { BitableClient, Model, Schema, FieldType } from '../src';

// ============================================================
// 1. 定义记录类型（TypeScript type alias，满足 Record<string, unknown> 约束）
// ============================================================
type UserRow = {
  name: string;
  age: number;
  email: string;
  active: boolean;
  tags: string[];
};

// ============================================================
// 2. 定义 Schema：用户侧 JS 属性名 ↔ 飞书字段名
// ============================================================
const userSchema = new Schema({
  name:   { fieldName: '姓名', type: FieldType.Text },
  age:    { fieldName: '年龄', type: FieldType.Number },
  email:  { fieldName: '邮箱', type: FieldType.Text, uiType: 'Email' },
  active: { fieldName: '启用', type: FieldType.Checkbox },
  tags:   { fieldName: '标签', type: FieldType.MultiSelect },
});

// ============================================================
// 3. 定义 Model：绑定数据表
// ============================================================
class UserModel extends Model<UserRow> {
  static tableId = process.env.TABLE_ID!;
  static schema = userSchema;
}

async function main() {
  // ============================================================
  // 4. 初始化客户端
  // ============================================================
  const client = new BitableClient({
    appId: process.env.APP_ID!,
    appSecret: process.env.APP_SECRET!,
    appToken: process.env.APP_TOKEN!,
    readQps: 20,
    writeQps: 50,
  });

  const users = new UserModel(client);

  // ============================================================
  // 5. Create：创建一条记录
  // ============================================================
  const created = await users.query().create({
    name: '张三',
    age: 28,
    email: 'zhangsan@example.com',
    active: true,
    tags: ['VIP', '广州'],
  });
  console.log('Created:', created.recordId, created.name);

  // ============================================================
  // 6. Read by ID：按 recordId 查找
  // ============================================================
  const found = await users.query().findById(created.recordId);
  console.log('Found:', found.name, found.age);

  // ============================================================
  // 7. Update：按 recordId 更新
  // ============================================================
  const updated = await users.query().updateById(created.recordId, {
    age: 29,
    active: false,
  });
  console.log('Updated age:', updated.age);

  // ============================================================
  // 8. Query：条件查询 + 排序 + 限制
  // ============================================================
  const results = await users
    .query()
    .where('active', '=', true)
    .where('age', '>', 18)
    .orderBy('age', 'desc')
    .limit(10)
    .findAll();
  console.log(`Found ${results.length} active users:`, results.map((u) => u.name));

  // 统计总数
  const total = await users.query().where('active', '=', true).count();
  console.log('Total active users:', total);

  // ============================================================
  // 9. Delete：按 recordId 删除
  // ============================================================
  await users.query().deleteById(created.recordId);
  console.log('Deleted:', created.recordId);
}

main().catch(console.error);
