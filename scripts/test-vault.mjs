import { mkdir, copyFile, writeFile } from 'node:fs/promises';
const root = '.test-vault';
const plugin = `${root}/.obsidian/plugins/document-framer`;
await mkdir(plugin, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css']) await copyFile(file, `${plugin}/${file}`);
await writeFile(`${root}/.obsidian/community-plugins.json`, JSON.stringify(['document-framer']));
try {
  await writeFile(`${root}/시작하기.md`, '# Document Framer 테스트\n\n이 문서에서 왼쪽 리본의 Framing 버튼을 누르세요.\n\n## 확인할 내용\n\n- 마지막 편집 후 60초 대기\n- 오른쪽 패널에서 테스트 결과 확인\n- 원문이 변경되지 않는지 확인\n\n[[두 번째 문서]]\n', { flag: 'wx' });
} catch (error) { if (error.code !== 'EEXIST') throw error; }
try { await writeFile(`${root}/두 번째 문서.md`, '# 두 번째 문서\n\n문서별 수동 요청을 테스트합니다.\n', { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
console.log(`Obsidian에서 기존 Vault 열기: ${process.cwd()}/${root}`);
