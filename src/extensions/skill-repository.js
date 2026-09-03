import fs from 'node:fs';
import path from 'node:path';

function getMasterSkillsDir() {
  if (process.env.SKILLS_MASTER_DIR) return process.env.SKILLS_MASTER_DIR;
  const dataDir = process.env.DATA_DIR || '/data';
  return path.join(dataDir, 'skills');
}

export function parseSkillFrontmatter(content) {
  if (!content) return { attributes: {}, body: '' };
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { attributes: {}, body: content.trim() };

  const rawYaml = match[1];
  const body = match[2].trim();
  const attributes = {};
  const lines = rawYaml.split(/\r?\n/);
  let currentKey = null;
  let currentValue = [];

  for (const line of lines) {
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (keyMatch) {
      if (currentKey) {
        attributes[currentKey] = currentValue.join(' ').trim().replace(/^['"]|['"]$/g, '');
      }
      currentKey = keyMatch[1];
      const val = keyMatch[2].trim();
      currentValue = (val === '>-' || val === '>' || val === '|') ? [] : [val];
    } else if (currentKey && /^\s+/.test(line)) {
      currentValue.push(line.trim());
    }
  }
  if (currentKey) {
    attributes[currentKey] = currentValue.join(' ').trim().replace(/^['"]|['"]$/g, '');
  }

  return { attributes, body };
}

export class SkillRepository {
  constructor(masterDir = null) {
    this.masterDir = masterDir || getMasterSkillsDir();
  }

  ensureDir() {
    fs.mkdirSync(this.masterDir, { recursive: true });
    return this.masterDir;
  }

  list() {
    this.ensureDir();
    const entries = fs.readdirSync(this.masterDir, { withFileTypes: true });
    const skills = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const skillDir = path.join(this.masterDir, entry.name);
      const skillFile = path.join(skillDir, 'SKILL.md');

      if (!fs.existsSync(skillFile)) continue;

      try {
        const raw = fs.readFileSync(skillFile, 'utf8');
        const { attributes, body } = parseSkillFrontmatter(raw);
        const name = attributes.name || entry.name;
        const description = attributes.description || '';

        const allFiles = fs.readdirSync(skillDir, { recursive: true });

        skills.push({
          name,
          dirName: entry.name,
          description,
          dirPath: skillDir,
          skillFilePath: skillFile,
          filesCount: allFiles.length,
          bodyLength: body.length,
          valid: true
        });
      } catch (err) {
        skills.push({
          name: entry.name,
          dirName: entry.name,
          description: `파싱 실패: ${err.message}`,
          dirPath: skillDir,
          skillFilePath: skillFile,
          valid: false
        });
      }
    }

    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  getByName(name) {
    const clean = String(name || '').trim();
    if (!clean) return null;
    const all = this.list();
    return all.find((s) => s.name === clean || s.dirName === clean) || null;
  }

  saveSkill(dirName, { skillMdContent, name = null, description = null } = {}) {
    const cleanDir = String(dirName || '').trim();
    if (!/^[a-z0-9._-]+$/.test(cleanDir)) {
      throw new Error('스킬 디렉토리명은 영소문자, 숫자, 점, 대시, 밑줄만 사용할 수 있습니다.');
    }
    this.ensureDir();
    const targetDir = path.join(this.masterDir, cleanDir);
    fs.mkdirSync(targetDir, { recursive: true });
    const targetFile = path.join(targetDir, 'SKILL.md');

    let content = skillMdContent;
    if (!content) {
      const skillName = name || cleanDir;
      const desc = description || `${skillName} skill instructions`;
      content = `---\nname: ${skillName}\ndescription: >-\n  ${desc}\n---\n\n# ${skillName}\n\nInstructions here.\n`;
    }

    fs.writeFileSync(targetFile, content, 'utf8');
    return this.getByName(cleanDir);
  }

  deleteSkill(nameOrDir) {
    const skill = this.getByName(nameOrDir);
    if (!skill) return false;
    fs.rmSync(skill.dirPath, { recursive: true, force: true });
    return true;
  }
}

export const skillRepository = new SkillRepository();
