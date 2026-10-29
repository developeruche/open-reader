import { describe, expect, it } from 'vitest';
import { OpfsStore, sha256Subtle, storageStatus } from '@/platform/opfs';

describe('OpfsStore (real OPFS)', () => {
  it('appends, resumes, commits, reads and removes', async () => {
    const s = new OpfsStore();
    const path = `test-${Math.random()}/models/m/file.bin`;
    expect(await s.partialSize(path)).toBe(0);
    let w = await s.appender(path);
    await w.write(new Uint8Array([1, 2, 3]));
    await w.close();
    expect(await s.partialSize(path)).toBe(3);
    w = await s.appender(path);
    await w.write(new Uint8Array([4, 5]));
    await w.close();
    expect(new Uint8Array(await s.readPartial(path))).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    await s.commit(path);
    expect(await s.size(path)).toBe(5);
    expect((await s.file(path))?.size).toBe(5);
    expect(await sha256Subtle(await s.read(path))).toMatch(/^[0-9a-f]{64}$/);
    await s.remove(path);
    expect(await s.size(path)).toBeUndefined();
    await s.discardPartial(path);
    await s.removeDir(path.split('/')[0]!);
    await expect(s.read(path)).rejects.toThrow('Missing');
    await expect(s.commit(path)).rejects.toThrow('Nothing to commit');
    const st = await storageStatus();
    expect(st.quota).toBeGreaterThan(0);
  });
});
