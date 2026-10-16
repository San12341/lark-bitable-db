/**
 * TypeScript 类型安全示例：泛型 Model、类型安全查询、字段提示
 *
 * 本示例展示 SDK 的完整类型推导能力。
 */

import { BitableClient, Model, Schema, FieldType, type PersonInfo, type AttachmentInfo } from '../src';

// ============================================================
// 1. 定义完整的记录类型（type alias 满足 Record<string, unknown> 约束）
// ============================================================
type EmployeeRow = {
  /** 姓名 */
  name: string;
  /** 年龄 */
  age: number;
  /** 邮箱 */
  email: string;
  /** 是否在职 */
  active: boolean;
  /** 职级：P5/P6/P7/P8 */
  level: string;
  /** 标签 */
  tags: string[];
  /** 入职日期 */
  hireDate: number;
  /** 直属上级（人员字段） */
  manager: PersonInfo[];
  /** 附件（简历等） */
  resume: AttachmentInfo[];
};

// ============================================================
// 2. Schema 定义：fieldName 必须与飞书表中一致
// ============================================================
const employeeSchema = new Schema({
  name:     { fieldName: '姓名', type: FieldType.Text },
  age:      { fieldName: '年龄', type: FieldType.Number },
  email:    { fieldName: '邮箱', type: FieldType.Text, uiType: 'Email' },
  active:   { fieldName: '在职', type: FieldType.Checkbox },
  level:    { fieldName: '职级', type: FieldType.SingleSelect },
  tags:     { fieldName: '标签', type: FieldType.MultiSelect },
  hireDate: { fieldName: '入职日期', type: FieldType.DateTime },
  manager:  { fieldName: '直属上级', type: FieldType.User },
  resume:   { fieldName: '简历', type: FieldType.Attachment },
});

// ============================================================
// 3. 泛型 Model：传入 EmployeeRow 获得完整类型推导
// ============================================================
class EmployeeModel extends Model<EmployeeRow> {
  static tableId = 'tblEmployee';
  static schema = employeeSchema;
}

async function demo() {
  const client = new BitableClient({
    appId: 'cli_xxx',
    appSecret: 'xxx',
    appToken: 'bascnxxx',
  });
  const employees = new EmployeeModel(client);

  // ---- create：入参类型为 Partial<EmployeeRow> ----
  const emp = await employees.query().create({
    name: '李四',
    age: 32,
    email: 'lisi@example.com',
    active: true,
    level: 'P7',
    tags: ['前端', '技术专家'],
    hireDate: new Date('2022-03-15').getTime(),
    manager: [{ id: 'ou_abc123', name: '王五' }],
    resume: [{ fileToken: 'file_token_xxx', name: 'resume.pdf' }],
  });
  // emp 类型: EmployeeRow & { recordId: string }
  emp.name;       // string
  emp.age;        // number
  emp.manager;    // PersonInfo[]
  emp.resume;     // AttachmentInfo[]
  emp.recordId;   // string

  // ---- where：fieldKey 受 Schema 约束 ----
  const p7s = await employees
    .query()
    .where('active', '=', true)
    .where('age', '>=', 30)
    .orderBy('age', 'desc')
    .limit(50)
    .findAll();
  p7s.forEach((e) => {
    console.log(e.name, e.level, e.hireDate);
  });

  // ---- findById 返回 EmployeeRow & { recordId } ----
  const one = await employees.query().findById(emp.recordId);
  one.name; // string

  // ---- count 返回 number ----
  const count: number = await employees.query().where('active', '=', true).count();

  // ---- updateById：data 类型为 Partial<EmployeeRow> ----
  await employees.query().updateById(emp.recordId, { active: false, level: 'P8' });

  // ---- findOne 返回 EmployeeRow | null ----
  const first = await employees.query().where('name', '=', '李四').findOne();
  if (first) {
    console.log(first.recordId, first.manager?.[0]?.name);
  }

  // ---- 自动分页：findAll 内部循环 page_token，调用方无感 ----
  const all = await employees.query().orderBy('age', 'asc').findAll();
  console.log(`Total employees: ${all.length}`);
}

demo().catch(console.error);
