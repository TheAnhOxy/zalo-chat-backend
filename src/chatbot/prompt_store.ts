import { readFile } from 'node:fs/promises';
import path from 'node:path';

type PromptKey = 'system.vi';

const promptFiles: Record<PromptKey, string> = {
  'system.vi': 'system.vi.md',
};

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k: string) => {
    const v = vars[k];
    return typeof v === 'string' ? v : '';
  });
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await readFile(p, { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

export class PromptStore {
  private cache = new Map<PromptKey, string>();
  private get isProd(): boolean {
    return (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
  }

  /**
   * Ưu tiên `PROMPTS_DIR` (absolute/relative).
   * Fallback lần lượt:
   * - `<cwd>/prompts`
   * - `<cwd>/src/chatbot/prompts`
   * - `<cwd>/dist/chatbot/prompts` (khi chạy build)
   */
  private candidateDirs(): string[] {
    const cwd = process.cwd();
    const envDir = (process.env.PROMPTS_DIR ?? '').trim();
    const dirs: string[] = [];
    if (envDir) {
      dirs.push(path.isAbsolute(envDir) ? envDir : path.resolve(cwd, envDir));
    }
    dirs.push(path.resolve(cwd, 'prompts'));
    dirs.push(path.resolve(cwd, 'src', 'chatbot', 'prompts'));
    dirs.push(path.resolve(cwd, 'dist', 'chatbot', 'prompts'));
    return dirs;
  }

  async getRaw(key: PromptKey): Promise<string> {
    // Dev: không cache để chỉnh prompt ăn ngay khi hot-reload.
    // Prod: cache để giảm IO.
    if (this.isProd) {
      const cached = this.cache.get(key);
      if (cached != null) return cached;
    }

    const fileName = promptFiles[key];
    for (const dir of this.candidateDirs()) {
      const p = path.join(dir, fileName);
      if (!(await fileExists(p))) continue;
      const content = await readFile(p, { encoding: 'utf-8' });
      const normalized = content.replace(/\r\n/g, '\n').trim();
      if (this.isProd) this.cache.set(key, normalized);
      return normalized;
    }
    throw new Error(
      `Không tìm thấy prompt '${key}'. Hãy cấu hình PROMPTS_DIR hoặc thêm file prompt.`,
    );
  }

  async render(key: PromptKey, vars: Record<string, string>): Promise<string> {
    const raw = await this.getRaw(key);
    return renderTemplate(raw, vars);
  }
}

export const promptStore = new PromptStore();
