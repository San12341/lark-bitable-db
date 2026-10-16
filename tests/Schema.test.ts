import { describe, it, expect } from 'vitest';
import { Schema } from '../src/model/Schema';
import { FieldType } from '../src/types';
import { BitableValidationError } from '../src/error';

describe('Schema', () => {
  it('maps user keys to field definitions', () => {
    const schema = new Schema({
      name: { fieldName: '姓名', type: FieldType.Text },
      age: { fieldName: '年龄', type: FieldType.Number },
    });
    expect(schema.getField('name')?.fieldName).toBe('姓名');
    expect(schema.getField('age')?.fieldName).toBe('年龄');
    expect(schema.getFieldByFieldName('姓名')?.type).toBe(FieldType.Text);
  });

  it('throws on duplicate fieldName', () => {
    expect(
      () =>
        new Schema({
          a: { fieldName: '姓名', type: FieldType.Text },
          b: { fieldName: '姓名', type: FieldType.Text },
        }),
    ).toThrow(BitableValidationError);
  });

  it('throws when fieldName is missing', () => {
    expect(
      () => new Schema({ a: { fieldName: '', type: FieldType.Text } as any }),
    ).toThrow(BitableValidationError);
  });

  it('serialize converts user object to feishu fields', () => {
    const schema = new Schema({
      name: { fieldName: '姓名', type: FieldType.Text },
      age: { fieldName: '年龄', type: FieldType.Number },
      active: { fieldName: '启用', type: FieldType.Checkbox },
    });
    const out = schema.serialize({ name: '张三', age: 30, active: true });
    expect(out).toEqual({
      '姓名': '张三',
      '年龄': 30,
      '启用': true,
    });
  });

  it('serialize skips keys not present in data', () => {
    const schema = new Schema({
      name: { fieldName: '姓名', type: FieldType.Text },
      age: { fieldName: '年龄', type: FieldType.Number },
    });
    const out = schema.serialize({ name: '李四' });
    expect(out).toEqual({ '姓名': '李四' });
    expect(out['年龄']).toBeUndefined();
  });

  it('serialize skips readonly fields', () => {
    const schema = new Schema({
      name: { fieldName: '姓名', type: FieldType.Text },
      createdAt: { fieldName: '创建时间', type: FieldType.CreatedTime },
    });
    const out = schema.serialize({ name: '王五', createdAt: 1704067200000 });
    expect(out).toEqual({ '姓名': '王五' });
    expect(out['创建时间']).toBeUndefined();
  });

  it('deserialize converts raw record to user object', () => {
    const schema = new Schema({
      name: { fieldName: '姓名', type: FieldType.Text },
      age: { fieldName: '年龄', type: FieldType.Number },
    });
    const raw = {
      record_id: 'recXXX',
      created_time: 1704067200000,
      fields: {
        '姓名': [{ text: '张三', type: 'text' }],
        '年龄': 30,
      },
    };
    const out = schema.deserialize(raw);
    expect(out.recordId).toBe('recXXX');
    expect(out.createdTime).toBe(1704067200000);
    expect(out.name).toBe('张三');
    expect(out.age).toBe(30);
  });

  it('deserialize includes record metadata', () => {
    const schema = new Schema({
      name: { fieldName: '姓名', type: FieldType.Text },
    });
    const raw = {
      record_id: 'rec1',
      created_time: 111,
      created_by: { id: 'ou_1' },
      last_modified_time: 222,
      last_modified_by: { id: 'ou_2' },
      fields: { '姓名': 'x' },
    };
    const out = schema.deserialize(raw);
    expect(out.createdTime).toBe(111);
    expect(out.createdBy).toEqual({ id: 'ou_1' });
    expect(out.lastModifiedTime).toBe(222);
    expect(out.lastModifiedBy).toEqual({ id: 'ou_2' });
  });

  it('auto-marks readonly types as readonly', () => {
    const schema = new Schema({
      formula: { fieldName: '公式', type: FieldType.Formula },
      lookup: { fieldName: '查找', type: FieldType.Lookup },
      autoNum: { fieldName: '编号', type: FieldType.AutoNumber },
    });
    expect(schema.getField('formula')?.readonly).toBe(true);
    expect(schema.getField('lookup')?.readonly).toBe(true);
    expect(schema.getField('autoNum')?.readonly).toBe(true);
  });

  it('validateFieldValue accepts valid value', () => {
    const schema = new Schema({
      age: { fieldName: '年龄', type: FieldType.Number },
    });
    expect(() => schema.validateFieldValue('age', 25)).not.toThrow();
  });

  it('validateFieldValue throws on unknown key', () => {
    const schema = new Schema({ name: { fieldName: '姓名', type: FieldType.Text } });
    expect(() => schema.validateFieldValue('nope', 1)).toThrow(BitableValidationError);
  });

  it('validateFieldValue throws on readonly field', () => {
    const schema = new Schema({
      createdAt: { fieldName: '创建时间', type: FieldType.CreatedTime },
    });
    expect(() => schema.validateFieldValue('createdAt', 123)).toThrow(BitableValidationError);
  });

  it('validateFieldValue throws on wrong type', () => {
    const schema = new Schema({
      age: { fieldName: '年龄', type: FieldType.Number },
    });
    expect(() => schema.validateFieldValue('age', 'abc')).toThrow(BitableValidationError);
  });
});
