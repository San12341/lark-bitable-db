import { describe, it, expect } from 'vitest';
import { FilterCompiler } from '../src/query/FilterCompiler';
import { Schema } from '../src/model/Schema';
import { FieldType, FilterOperator } from '../src/types';
import { BitableValidationError } from '../src/error';

const schema = new Schema({
  name: { fieldName: '姓名', type: FieldType.Text },
  age: { fieldName: '年龄', type: FieldType.Number },
  active: { fieldName: '启用', type: FieldType.Checkbox },
  joinedAt: { fieldName: '加入时间', type: FieldType.DateTime },
  tags: { fieldName: '标签', type: FieldType.MultiSelect },
});

const compiler = new FilterCompiler(schema);

describe('FilterCompiler', () => {
  it('compiles simple where condition with field name mapping', () => {
    const group = compiler.compile(
      [{ fieldKey: 'name', operator: FilterOperator.Is, value: '张三' }],
      'and',
    );
    expect(group).toEqual({
      conjunction: 'and',
      conditions: [{ field_name: '姓名', operator: 'is', value: ['张三'] }],
    });
  });

  it('converts number value to string', () => {
    const group = compiler.compile(
      [{ fieldKey: 'age', operator: FilterOperator.IsGreater, value: 18 }],
      'and',
    );
    expect(group.conditions[0].value).toEqual(['18']);
  });

  it('converts Date to ms timestamp string', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    const group = compiler.compile(
      [{ fieldKey: 'joinedAt', operator: FilterOperator.IsGreater, value: d }],
      'and',
    );
    expect(group.conditions[0].value).toEqual([String(d.getTime())]);
  });

  it('converts boolean to "true"/"false"', () => {
    const group = compiler.compile(
      [{ fieldKey: 'active', operator: FilterOperator.Is, value: true }],
      'and',
    );
    expect(group.conditions[0].value).toEqual(['true']);
  });

  it('isEmpty/isNotEmpty produce empty value array', () => {
    const g1 = compiler.compile(
      [{ fieldKey: 'name', operator: FilterOperator.IsEmpty, value: undefined }],
      'and',
    );
    expect(g1.conditions[0].value).toEqual([]);

    const g2 = compiler.compile(
      [{ fieldKey: 'name', operator: FilterOperator.IsNotEmpty, value: undefined }],
      'and',
    );
    expect(g2.conditions[0].value).toEqual([]);
  });

  it('null/undefined value → empty array', () => {
    const group = compiler.compile(
      [{ fieldKey: 'name', operator: FilterOperator.Is, value: null }],
      'and',
    );
    expect(group.conditions[0].value).toEqual([]);
  });

  it('array value expands to multiple strings', () => {
    const group = compiler.compile(
      [{ fieldKey: 'tags', operator: FilterOperator.Is, value: ['a', 'b', 'c'] }],
      'and',
    );
    expect(group.conditions[0].value).toEqual(['a', 'b', 'c']);
  });

  it('supports or conjunction', () => {
    const group = compiler.compile(
      [
        { fieldKey: 'name', operator: FilterOperator.Is, value: 'A' },
        { fieldKey: 'name', operator: FilterOperator.Is, value: 'B' },
      ],
      'or',
    );
    expect(group.conjunction).toBe('or');
    expect(group.conditions).toHaveLength(2);
  });

  it('throws on unknown fieldKey', () => {
    expect(() =>
      compiler.compile(
        [{ fieldKey: 'nonexistent', operator: FilterOperator.Is, value: 'x' }],
        'and',
      ),
    ).toThrow(BitableValidationError);
  });

  it('operator values pass through as-is', () => {
    const group = compiler.compile(
      [{ fieldKey: 'age', operator: FilterOperator.IsLessEqual, value: 100 }],
      'and',
    );
    expect(group.conditions[0].operator).toBe('isLessEqual');
  });
});
