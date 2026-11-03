<script setup lang="ts">
import { useDemoI18n } from '../i18n';
import { computed, onUnmounted, ref, useId, watch } from 'vue';
import skillMarkdown from '../../../../skills/filens/SKILL.md?raw';
import WorkbenchIcon from './WorkbenchIcon.vue';

const { locale, isEnglish, t } = useDemoI18n();

const audience = ref<'human' | 'agent'>('human');
const target = ref('auto');
const scope = ref('global');
const profile = ref('full');
const copied = ref('');
const copyError = ref(false);
const id = useId();
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
const repo = 'https://github.com/IceWhaleTech/filens';
const skillUrl = `${import.meta.env.BASE_URL}skills/filens/SKILL.md`;
const installCommand = computed(() => [
  'npx --yes skills add IceWhaleTech/filens --skill filens',
  target.value === 'auto' ? '' : `--agent ${target.value}`,
  scope.value === 'global' ? '--global' : '',
  '--yes'
].filter(Boolean).join(' '));
const cliCommand = computed(() => `npm install -g ${profile.value === 'full' ? 'filens-cli' : 'filens-cli-lite'}`);
const installPrompt = computed(() => t(
  `帮我安装 filens，去 ${repo} 找 skills/filens/SKILL.md，按里面的说明配置 ${profile.value === 'full' ? 'Full 版 CLI（含中英文 OCR）' : 'Lite 版 CLI（按需安装 OCR）'} 和 Skill。${scope.value === 'global' ? '把 Skill 装到用户目录，供所有项目使用' : '把 Skill 装到当前项目'}${target.value === 'auto' ? '，适配当前 Agent' : `，供 ${target.value} 使用`}。装好后运行 filens capacity --json 检查是否可用，并告诉我结果。`,
  `Install filens for me. Find skills/filens/SKILL.md at ${repo} and follow its instructions to set up the ${profile.value === 'full' ? 'Full CLI (with Chinese and English OCR)' : 'Lite CLI (install OCR as needed)'} and skill. ${scope.value === 'global' ? 'Install the skill in my user directory for all projects' : 'Install the skill in the current project'}${target.value === 'auto' ? ', for my current Agent' : `, for ${target.value}`}. After installation, run filens capacity --json to verify it works and report the results.`
));
watch([installCommand, cliCommand, locale], () => {
  if (['install', 'cli', 'prompt'].includes(copied.value)) copied.value = '';
});
const capabilities = computed(() => [
  { icon: 'file', title: t('读取文档', 'Read documents'), description: t('读取 PDF、Office 和表格，交付原文与可引用的证据。', 'Read PDFs, Office documents, and spreadsheets with source text and citable evidence.'), command: 'filens read "report.pdf" --json' },
  { icon: 'search', title: t('跨文件搜索', 'Search across files'), description: t('搜索目录、压缩包和嵌套文件，保留命中片段与来源。', 'Search folders, archives, and nested files, keeping matching passages and their sources.'), command: t('filens search "./documents" --query "预算 风险" --json', 'filens search "./documents" --query "budget risk" --json') },
  { icon: 'scan', title: t('OCR 与布局', 'OCR and layout'), description: t('识别扫描件与图片中的文字，获取可用的页码和坐标。', 'Recognize text in scans and images, with page numbers and coordinates when available.'), command: 'filens layout "invoice.png" --json' },
  { icon: 'sliders', title: t('提取关键内容', 'Extract key content'), description: t('按主题与字数预算选取关键原文，保留出处和省略标记。', 'Select key source passages by topic and word budget, preserving references and omission markers.'), command: t('filens summarize "report.pdf" --query "预算 风险" --json', 'filens summarize "report.pdf" --query "budget risk" --json') },
  { icon: 'copy', title: t('重复文件与相似图片', 'Duplicates and similar images'), description: t('扫描重复文件和缩放、压缩后的图片变体，输出分组供核对。', 'Find duplicate files and resized or compressed image variants, grouped for review.'), command: 'filens similar-images "./photos" --threshold 8 --json' },
  { icon: 'arrow', title: t('文件转换', 'Convert files'), description: t('转换支持的格式，例如 DOC 转 DOCX、CSV 转 XLSX。', 'Convert supported formats, such as DOC to DOCX and CSV to XLSX.'), command: 'filens convert "report.doc" --output "report.docx" --json' }
] as const);

async function copy(value: string, key: string): Promise<void> {
  clearTimeout(feedbackTimer);
  copied.value = '';
  copyError.value = false;
  try {
    await navigator.clipboard.writeText(value);
    copied.value = key;
    feedbackTimer = setTimeout(() => { copied.value = ''; }, 5000);
  } catch {
    copyError.value = true;
  }
}
onUnmounted(() => clearTimeout(feedbackTimer));
</script>

<template>
  <section class="agent-workbench" :aria-label="t('Agent 功能与 Skill 安装', 'Agent capabilities and skill installation')">
    <div class="agent-content">
      <header class="agent-intro">
        <p class="wb-eyebrow">FILENS FOR AGENTS</p>
        <h2>{{ t('让 Agent 读懂你的文件。', 'Help your Agent understand your files.') }}</h2>
        <p>{{ t('支持 334 种文件格式（按扩展名统计），读取、搜索、识别与转换，在本地完成。把有出处的原文交给 Agent，继续分析与问答。', 'Supports 334 file formats (counted by extension). Read, search, recognize, and convert locally. Give your Agent source text with references for further analysis and answers.') }}</p>
        <div class="agent-intro-actions">
          <button type="button" class="wb-button agent-primary" @click="copy(installPrompt, 'prompt')"><WorkbenchIcon :name="copied === 'prompt' ? 'check' : 'copy'" />{{ copied === 'prompt' ? t('安装提示已复制', 'Install prompt copied') : t('复制给 Agent 安装', 'Copy install prompt for Agent') }}</button>
        </div>
        <p class="agent-install-note">{{ t('复制一句话发给你的 Agent，让它完成安装；下方也提供手动安装选项。', 'Copy the prompt to your Agent to set things up, or use the manual installation options below.') }}</p>
      </header>

      <div class="agent-audience" role="group" :aria-label="t('说明阅读方式', 'Guide audience')">
        <button :id="`${id}-human`" type="button" :aria-pressed="audience === 'human'" :aria-controls="`${id}-human-content`" @click="audience = 'human'">{{ t('给人看', 'For people') }} <span>{{ t('能力与上手指南', 'Capabilities and getting started') }}</span></button>
        <button :id="`${id}-agent`" type="button" :aria-pressed="audience === 'agent'" :aria-controls="`${id}-agent-content`" @click="audience = 'agent'">{{ t('给 Agent 看', 'For Agents') }} <span>{{ t('SKILL.md 原文', 'SKILL.md source') }}</span></button>
      </div>

      <div v-show="audience === 'human'" :id="`${id}-human-content`" :aria-labelledby="`${id}-human`">
        <section class="agent-capabilities" :aria-label="t('Agent 能力', 'Agent capabilities')">
          <article v-for="(capability, index) in capabilities" :key="capability.title" class="agent-card">
            <div class="agent-card-heading"><WorkbenchIcon :name="capability.icon" /><h3>{{ capability.title }}</h3></div>
            <p>{{ capability.description }}</p>
            <div class="agent-example"><code>{{ capability.command }}</code><button type="button" class="wb-icon-button" :aria-label="t(`复制${capability.title}命令`, `Copy ${capability.title.toLowerCase()} command`)" @click="copy(capability.command, `example-${index}`)"><WorkbenchIcon :name="copied === `example-${index}` ? 'check' : 'copy'" /></button></div>
          </article>
        </section>
        <p class="agent-boundary">{{ t('此处展示本地 CLI 用法。运行', 'These examples use the local CLI. Run') }} <code>filens capacity --json</code> {{ t('确认当前安装支持的能力；总结改写和问答由上层 Agent 完成。', 'to check the capabilities of your installation. Your Agent handles summaries, rewriting, and questions.') }}</p>

        <section class="agent-setup" aria-labelledby="agent-setup-heading">
          <div class="agent-section-heading"><div><p class="wb-eyebrow">GET STARTED</p><h3 id="agent-setup-heading">{{ t('安装与接入', 'Install and connect') }}</h3></div><span>{{ t('需要 Node.js 20.11+', 'Requires Node.js 20.11+') }}</span></div>
          <div class="agent-setup-step">
            <span class="agent-step-number">01</span>
            <div class="agent-step-content">
              <h4>{{ t('安装 FiLens CLI', 'Install FiLens CLI') }}</h4><p>{{ t('选择一个版本安装，两者都提供', 'Choose an edition; both provide the') }} <code>filens</code> {{ t('命令。', 'command.') }}</p>
              <label class="agent-select">{{ t('CLI 版本', 'CLI edition') }}<select v-model="profile"><option value="full">{{ t('Full · 含中英文 OCR', 'Full · Chinese and English OCR included') }}</option><option value="lite">{{ t('Lite · 按需安装 OCR', 'Lite · Install OCR as needed') }}</option></select></label>
              <div class="agent-command"><code>{{ cliCommand }}</code><button type="button" class="wb-button" @click="copy(cliCommand, 'cli')"><WorkbenchIcon :name="copied === 'cli' ? 'check' : 'copy'" />{{ copied === 'cli' ? t('已复制', 'Copied') : t('复制 CLI 安装命令', 'Copy CLI install command') }}</button></div>
              <p v-if="profile === 'lite'" class="agent-step-hint">{{ t('需要识别图片时，运行', 'To recognize text in images, run') }} <code>filens setup-ocr</code> {{ t('补装 OCR。', 'to install OCR.') }}</p>
            </div>
          </div>
          <div class="agent-setup-step">
            <span class="agent-step-number">02</span>
            <div class="agent-step-content">
              <h4>{{ t('把 Skill 装给你的 Agent', 'Install the skill for your Agent') }}</h4><p>{{ t('Skill 告诉 Agent 如何调用 FiLens、检查结果和引用原文。', 'The skill tells your Agent how to use FiLens, check results, and cite source text.') }}</p>
              <div class="agent-selects">
                <label class="agent-select">{{ t('目标 Agent', 'Target Agent') }}<select v-model="target"><option value="auto">{{ t('自动检测', 'Auto-detect') }}</option><option value="codex">Codex</option><option value="claude-code">Claude Code</option><option value="cursor">Cursor</option><option value="opencode">OpenCode</option></select></label>
                <label class="agent-select">{{ t('安装范围', 'Install scope') }}<select v-model="scope"><option value="global">{{ t('用户目录 · 所有项目可用', 'User directory · All projects') }}</option><option value="project">{{ t('当前项目', 'Current project') }}</option></select></label>
              </div>
              <div class="agent-command"><code>{{ installCommand }}</code><button type="button" class="wb-button" @click="copy(installCommand, 'install')"><WorkbenchIcon :name="copied === 'install' ? 'check' : 'copy'" />{{ copied === 'install' ? t('已复制', 'Copied') : t('复制 Skill 安装命令', 'Copy skill install command') }}</button></div>
              <p class="agent-step-hint">{{ scope === 'project' ? t('在目标项目目录执行。', 'Run in the target project directory. ') : t('安装到用户技能目录。', 'Install in your user skills directory. ') }}{{ t('通过', 'After installing with') }} <a href="https://github.com/vercel-labs/skills" target="_blank" rel="noopener noreferrer">skills CLI</a> {{ t('安装后，按所用 Agent 的方式重新加载技能或开启新会话。', 'reload skills or start a new session as required by your Agent.') }}</p>
            </div>
          </div>
          <div class="agent-setup-step">
            <span class="agent-step-number">03</span>
            <div class="agent-step-content"><h4>{{ t('验证，然后开始使用', 'Verify and start using it') }}</h4><p>{{ t('在终端检查能力，或让 Agent 使用 FiLens 读取你的文件。', 'Check capabilities in your terminal, or ask your Agent to read a file with FiLens.') }}</p><div class="agent-command"><code>filens capacity --json</code><button type="button" class="wb-button" @click="copy('filens capacity --json', 'capacity')"><WorkbenchIcon :name="copied === 'capacity' ? 'check' : 'copy'" />{{ copied === 'capacity' ? t('已复制', 'Copied') : t('复制验证命令', 'Copy verification command') }}</button></div></div>
          </div>
        </section>
      </div>

      <section v-show="audience === 'agent'" :id="`${id}-agent-content`" class="agent-skill" :aria-labelledby="`${id}-agent`">
        <header class="agent-skill-heading"><div><h3>SKILL.md</h3><p>{{ t('与发布包共用的 Skill 原文，包含调用约定、证据定位与错误处理。', 'The same skill source shipped in the release, covering invocation, evidence references, and error handling.') }}</p></div><div class="agent-skill-actions"><button type="button" class="wb-button" @click="copy(skillMarkdown, 'skill')"><WorkbenchIcon :name="copied === 'skill' ? 'check' : 'copy'" />{{ copied === 'skill' ? t('已复制', 'Copied') : t('复制 SKILL.md', 'Copy SKILL.md') }}</button><a class="wb-button" :href="skillUrl" download="SKILL.md"><WorkbenchIcon name="download" />{{ t('下载 SKILL.md', 'Download SKILL.md') }}</a></div></header>
        <p class="agent-skill-link">{{ t('可直接交给 Agent 的地址：', 'Share this URL with your Agent: ') }}<a :href="skillUrl" target="_blank" rel="noopener noreferrer">skills/filens/SKILL.md ↗</a></p>
        <pre tabindex="0" :aria-label="t('SKILL.md 原文', 'SKILL.md source')"><code>{{ skillMarkdown }}</code></pre>
      </section>

      <footer class="agent-footer"><span><WorkbenchIcon name="lock" />{{ t('文件在本地处理 · 首次安装需要联网', 'Files are processed locally · Initial setup requires internet access') }}</span><a :href="`${repo}/blob/main/docs/agent-cli${isEnglish ? '' : '.zh-CN'}.md`" target="_blank" rel="noopener noreferrer">{{ t('完整 CLI 文档 ↗', 'Full CLI documentation ↗') }}</a><a :href="skillUrl" download="SKILL.md">{{ t('下载 Skill', 'Download skill') }}</a></footer>
    </div>
    <p v-if="copied || copyError" class="agent-feedback" :class="{ 'is-error': copyError }" role="status">{{ copyError ? t('复制失败，请手动选择命令或原文复制。', 'Copy failed. Select and copy the command or source text manually.') : copied === 'install' ? t('安装命令已复制，请在终端运行。', 'Install command copied. Run it in your terminal.') : copied === 'prompt' ? t('安装提示已复制，粘贴给你的 Agent 即可。', 'Install prompt copied. Paste it into your Agent.') : t('已复制到剪贴板。', 'Copied to clipboard.') }}</p>
  </section>
</template>

<style src="./agent-workbench.css"></style>
