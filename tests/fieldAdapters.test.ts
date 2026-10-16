import { describe, it, expect } from 'vitest';
import { FieldType } from '../src/types';
import { BitableValidationError } from '../src/error';
import { createDefaultRegistry } from '../src/model/fieldAdapters';
import type { FieldAdapter, FieldDefinition } from '../src/model/FieldAdapter';

const registry = createDefaultRegistry();

function def(type: FieldType, extra: Partial<FieldDefinition> = {}): FieldDefinition {
  return { fieldName: 'test', type, ...extra };
}

function adapterFor(type: FieldType): FieldAdapter {
  return registry.get(type);
}

describe('textAdapter', () => {
  const a = () => adapterFor(FieldType.Text);

  it('serialize string → string', () => {
    expect(a().serialize('hello', def(FieldType.Text))).toBe('hello');
  });

  it('serialize null → null', () => {
    expect(a().serialize(null, def(FieldType.Text))).toBeNull();
    expect(a().serialize(undefined, def(FieldType.Text))).toBeNull();
  });

  it('serialize non-string throws', () => {
    expect(() => a().serialize(123, def(FieldType.Text))).toThrow(BitableValidationError);
  });

  it('deserialize rich text array → plain string', () => {
    const raw = [
      { text: 'Hello ', type: 'text' },
      { text: 'World', type: 'text' },
    ];
    expect(a().deserialize(raw, def(FieldType.Text))).toBe('Hello World');
  });

  it('deserialize plain string passes through', () => {
    expect(a().deserialize('just text', def(FieldType.Text))).toBe('just text');
  });

  it('deserialize null → null', () => {
    expect(a().deserialize(null, def(FieldType.Text))).toBeNull();
  });

  it('deserialize Email uiType extracts email from mailto link', () => {
    const raw = [{ text: 'a@b.com', link: 'mailto:a@b.com', type: 'url' }];
    expect(a().deserialize(raw, def(FieldType.Text, { uiType: 'Email' }))).toBe('a@b.com');
  });
});

describe('numberAdapter', () => {
  const a = () => adapterFor(FieldType.Number);

  it('serialize number → number', () => {
    expect(a().serialize(42, def(FieldType.Number))).toBe(42);
  });

  it('serialize numeric string → number', () => {
    expect(a().serialize('3.14', def(FieldType.Number))).toBe(3.14);
  });

  it('serialize null → null', () => {
    expect(a().serialize(null, def(FieldType.Number))).toBeNull();
  });

  it('serialize invalid throws', () => {
    expect(() => a().serialize('abc', def(FieldType.Number))).toThrow(BitableValidationError);
    expect(() => a().serialize(NaN, def(FieldType.Number))).toThrow(BitableValidationError);
  });

  it('deserialize number → number', () => {
    expect(a().deserialize(99, def(FieldType.Number))).toBe(99);
  });

  it('deserialize numeric string → number', () => {
    expect(a().deserialize('7', def(FieldType.Number))).toBe(7);
  });

  it('deserialize null → null', () => {
    expect(a().deserialize(null, def(FieldType.Number))).toBeNull();
  });
});

describe('singleSelectAdapter', () => {
  const a = () => adapterFor(FieldType.SingleSelect);

  it('serialize string → string', () => {
    expect(a().serialize('active', def(FieldType.SingleSelect))).toBe('active');
  });

  it('serialize null → null', () => {
    expect(a().serialize(null, def(FieldType.SingleSelect))).toBeNull();
  });

  it('serialize non-string throws', () => {
    expect(() => a().serialize(1, def(FieldType.SingleSelect))).toThrow();
  });

  it('deserialize value → string', () => {
    expect(a().deserialize('active', def(FieldType.SingleSelect))).toBe('active');
  });
});

describe('multiSelectAdapter', () => {
  const a = () => adapterFor(FieldType.MultiSelect);

  it('serialize string[] → string[]', () => {
    expect(a().serialize(['a', 'b'], def(FieldType.MultiSelect))).toEqual(['a', 'b']);
  });

  it('serialize single string → [string]', () => {
    expect(a().serialize('only', def(FieldType.MultiSelect))).toEqual(['only']);
  });

  it('serialize null → null', () => {
    expect(a().serialize(null, def(FieldType.MultiSelect))).toBeNull();
  });

  it('deserialize array → string[]', () => {
    expect(a().deserialize(['x', 'y'], def(FieldType.MultiSelect))).toEqual(['x', 'y']);
  });

  it('deserialize scalar → [scalar]', () => {
    expect(a().deserialize('only', def(FieldType.MultiSelect))).toEqual(['only']);
  });
});

describe('dateTimeAdapter', () => {
  const a = () => adapterFor(FieldType.DateTime);

  it('serialize Date → ms timestamp', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    expect(a().serialize(d, def(FieldType.DateTime))).toBe(d.getTime());
  });

  it('serialize number → number', () => {
    expect(a().serialize(1704067200000, def(FieldType.DateTime))).toBe(1704067200000);
  });

  it('serialize null → null', () => {
    expect(a().serialize(null, def(FieldType.DateTime))).toBeNull();
  });

  it('deserialize number → number', () => {
    expect(a().deserialize(1704067200000, def(FieldType.DateTime))).toBe(1704067200000);
  });

  it('deserialize with returnDate=true → Date', () => {
    const d = def(FieldType.DateTime);
    (d as FieldDefinition & { returnDate?: boolean }).returnDate = true;
    const result = a().deserialize(1704067200000, d);
    expect(result).toBeInstanceOf(Date);
    expect((result as Date).getTime()).toBe(1704067200000);
  });

  it('deserialize null → null', () => {
    expect(a().deserialize(null, def(FieldType.DateTime))).toBeNull();
  });
});

describe('checkboxAdapter', () => {
  const a = () => adapterFor(FieldType.Checkbox);

  it('serialize boolean → boolean', () => {
    expect(a().serialize(true, def(FieldType.Checkbox))).toBe(true);
    expect(a().serialize(false, def(FieldType.Checkbox))).toBe(false);
  });

  it('serialize null → null', () => {
    expect(a().serialize(null, def(FieldType.Checkbox))).toBeNull();
  });

  it('serialize non-boolean throws', () => {
    expect(() => a().serialize('yes', def(FieldType.Checkbox))).toThrow();
  });

  it('deserialize truthy → true', () => {
    expect(a().deserialize(true, def(FieldType.Checkbox))).toBe(true);
    expect(a().deserialize(1, def(FieldType.Checkbox))).toBe(true);
  });

  it('deserialize null → null', () => {
    expect(a().deserialize(null, def(FieldType.Checkbox))).toBeNull();
  });
});

describe('userAdapter', () => {
  const a = () => adapterFor(FieldType.User);

  it('serialize single id string → [{id}]', () => {
    expect(a().serialize('ou_123', def(FieldType.User))).toEqual([{ id: 'ou_123' }]);
  });

  it('serialize string[] → [{id},{id}]', () => {
    expect(a().serialize(['ou_1', 'ou_2'], def(FieldType.User))).toEqual([
      { id: 'ou_1' },
      { id: 'ou_2' },
    ]);
  });

  it('serialize {id} object → [{id}]', () => {
    expect(a().serialize({ id: 'ou_3' }, def(FieldType.User))).toEqual([{ id: 'ou_3' }]);
  });

  it('serialize null → null', () => {
    expect(a().serialize(null, def(FieldType.User))).toBeNull();
  });

  it('deserialize array → PersonInfo[]', () => {
    const raw = [
      { id: 'ou_1', name: 'Alice', en_name: 'AliceE', avatar_url: 'http://x/a.png', email: 'a@b.c' },
      { id: 'ou_2', name: 'Bob' },
    ];
    const result = a().deserialize(raw, def(FieldType.User)) as any[];
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('ou_1');
    expect(result[0].name).toBe('Alice');
    expect(result[0].enName).toBe('AliceE');
    expect(result[0].avatarUrl).toBe('http://x/a.png');
    expect(result[0].email).toBe('a@b.c');
    expect(result[1].name).toBe('Bob');
  });

  it('deserialize null → null', () => {
    expect(a().deserialize(null, def(FieldType.User))).toBeNull();
  });
});

describe('urlAdapter', () => {
  const a = () => adapterFor(FieldType.Url);

  it('serialize string → {text, link}', () => {
    expect(a().serialize('https://x.com', def(FieldType.Url))).toEqual({
      text: 'https://x.com',
      link: 'https://x.com',
    });
  });

  it('serialize {text, link} → {text, link}', () => {
    expect(
      a().serialize({ text: '百度', link: 'https://baidu.com' }, def(FieldType.Url)),
    ).toEqual({ text: '百度', link: 'https://baidu.com' });
  });

  it('serialize null → null', () => {
    expect(a().serialize(null, def(FieldType.Url))).toBeNull();
  });

  it('deserialize → {text, link}', () => {
    const raw = { text: 'Baidu', link: 'https://baidu.com' };
    expect(a().deserialize(raw, def(FieldType.Url))).toEqual({
      text: 'Baidu',
      link: 'https://baidu.com',
    });
  });
});

describe('attachmentAdapter', () => {
  const a = () => adapterFor(FieldType.Attachment);

  it('serialize string[] → [{file_token}]', () => {
    expect(a().serialize(['tok1', 'tok2'], def(FieldType.Attachment))).toEqual([
      { file_token: 'tok1' },
      { file_token: 'tok2' },
    ]);
  });

  it('serialize null → null', () => {
    expect(a().serialize(null, def(FieldType.Attachment))).toBeNull();
  });

  it('deserialize → AttachmentInfo[]', () => {
    const raw = [
      { file_token: 'tok1', name: 'a.png', type: 'image/png', size: 100, url: 'http://x/a' },
    ];
    const result = a().deserialize(raw, def(FieldType.Attachment)) as any[];
    expect(result[0].fileToken).toBe('tok1');
    expect(result[0].name).toBe('a.png');
    expect(result[0].size).toBe(100);
  });

  it('deserialize null → null', () => {
    expect(a().deserialize(null, def(FieldType.Attachment))).toBeNull();
  });
});

describe('singleLinkAdapter', () => {
  const a = () => adapterFor(FieldType.SingleLink);

  it('serialize string[] → {link_record_ids}', () => {
    expect(a().serialize(['rec1', 'rec2'], def(FieldType.SingleLink))).toEqual({
      link_record_ids: ['rec1', 'rec2'],
    });
  });

  it('serialize null → null', () => {
    expect(a().serialize(null, def(FieldType.SingleLink))).toBeNull();
  });

  it('deserialize {link_record_ids} → string[]', () => {
    expect(
      a().deserialize({ link_record_ids: ['rec1', 'rec2'] }, def(FieldType.SingleLink)),
    ).toEqual(['rec1', 'rec2']);
  });

  it('deserialize array → string[]', () => {
    expect(a().deserialize(['rec1', 'rec2'], def(FieldType.SingleLink))).toEqual(['rec1', 'rec2']);
  });
});

describe('readonly adapters', () => {
  it('lookup serialize throws', () => {
    const a = adapterFor(FieldType.Lookup);
    expect(a.isReadOnly(def(FieldType.Lookup))).toBe(true);
    expect(() => a.serialize('x', def(FieldType.Lookup))).toThrow(BitableValidationError);
  });

  it('formula serialize throws', () => {
    const a = adapterFor(FieldType.Formula);
    expect(a.isReadOnly(def(FieldType.Formula))).toBe(true);
    expect(() => a.serialize('x', def(FieldType.Formula))).toThrow(BitableValidationError);
  });

  it('createdTime serialize throws', () => {
    const a = adapterFor(FieldType.CreatedTime);
    expect(a.isReadOnly(def(FieldType.CreatedTime))).toBe(true);
    expect(() => a.serialize(123, def(FieldType.CreatedTime))).toThrow(BitableValidationError);
  });

  it('modifiedTime serialize throws', () => {
    const a = adapterFor(FieldType.ModifiedTime);
    expect(() => a.serialize(123, def(FieldType.ModifiedTime))).toThrow();
  });

  it('createdUser serialize throws', () => {
    const a = adapterFor(FieldType.CreatedUser);
    expect(() => a.serialize('x', def(FieldType.CreatedUser))).toThrow();
  });

  it('modifiedUser serialize throws', () => {
    const a = adapterFor(FieldType.ModifiedUser);
    expect(() => a.serialize('x', def(FieldType.ModifiedUser))).toThrow();
  });

  it('autoNumber serialize throws', () => {
    const a = adapterFor(FieldType.AutoNumber);
    expect(() => a.serialize('x', def(FieldType.AutoNumber))).toThrow();
  });

  it('deserialize readonly fields still works', () => {
    const lookup = adapterFor(FieldType.Lookup);
    expect(lookup.deserialize({ type: 20, ui_type: 'Formula', value: [1] }, def(FieldType.Lookup))).toEqual({
      type: 20,
      uiType: 'Formula',
      value: [1],
    });

    const ct = adapterFor(FieldType.CreatedTime);
    expect(ct.deserialize(1704067200000, def(FieldType.CreatedTime))).toBe(1704067200000);
  });
});

describe('registry', () => {
  it('has all 20 built-in types registered', () => {
    const types = [
      FieldType.Text, FieldType.Number, FieldType.SingleSelect, FieldType.MultiSelect,
      FieldType.DateTime, FieldType.Checkbox, FieldType.User, FieldType.Phone,
      FieldType.Url, FieldType.Attachment, FieldType.SingleLink, FieldType.Lookup,
      FieldType.Formula, FieldType.DuplexLink, FieldType.Location,
      FieldType.CreatedTime, FieldType.ModifiedTime, FieldType.CreatedUser,
      FieldType.ModifiedUser, FieldType.AutoNumber,
    ];
    for (const t of types) {
      expect(registry.has(t)).toBe(true);
    }
  });

  it('get unregistered type throws', () => {
    const r = createDefaultRegistry();
    r.unregister(FieldType.Phone);
    expect(() => r.get(FieldType.Phone)).toThrow(BitableValidationError);
  });
});
