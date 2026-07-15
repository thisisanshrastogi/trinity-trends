#!/usr/bin/env node
import * as p from '@clack/prompts';
import pc from 'picocolors';
import wrapAnsi from 'wrap-ansi';
import { uniqueNamesGenerator, adjectives, colors, animals } from 'unique-names-generator';
import figlet from 'figlet';
// @ts-ignore
import quotes from 'inspirational-quotes';
import { OrchestratorClient } from './orchestrator.client.js';
import { SqliteRepository } from '../storage/sqlite/sqlite.repository.js';
import { User, Session } from '../storage/storage.types.js';
import { UpgradeManager } from '../upgrade/upgrade.manager.js';
import { getCurrentVersion } from '../upgrade/version.js';

const banner = `
████████╗██████╗ ██╗███╗   ██╗██╗████████╗██╗   ██╗
╚══██╔══╝██╔══██╗██║████╗  ██║██║╚══██╔══╝╚██╗ ██╔╝
   ██║   ██████╔╝██║██╔██╗ ██║██║   ██║    ╚████╔╝ 
   ██║   ██╔══██╗██║██║╚██╗██║██║   ██║     ╚██╔╝  
   ██║   ██║  ██║██║██║ ╚████║██║   ██║      ██║   
   ╚═╝   ╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝╚═╝   ╚═╝      ╚═╝   
 ████████╗██████╗ ███████╗███╗   ██╗██████╗ ███████╗
 ╚══██╔══╝██╔══██╗██╔════╝████╗  ██║██╔══██╗██╔════╝
    ██║   ██████╔╝█████╗  ██╔██╗ ██║██║  ██║███████╗
    ██║   ██╔══██╗██╔══╝  ██║╚██╗██║██║  ██║╚════██║
    ██║   ██║  ██║███████╗██║ ╚████║██████╔╝███████║
    ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═══╝╚═════╝ ╚══════╝
                                    - A Pretty Trends Analyzer -
`;

const orchestrator = new OrchestratorClient();
const repo = new SqliteRepository();

function exitApp(): never {
  console.log('\n');
  const ascii = figlet.textSync('See ya!', { font: 'Slant' });
  console.log(pc.cyan(ascii));

  const quote = quotes.getQuote();
  const separator = pc.magenta('━'.repeat(60));

  console.log(separator);
  console.log(pc.italic(pc.white(`  "${quote.text}"`)));
  console.log(pc.gray(`       — ${quote.author}`));
  console.log(separator + '\n');

  process.exit(0);
}

// Helper to pause
async function pause() {
  await p.text({ message: 'Press Enter to continue...', placeholder: '', defaultValue: '' });
}

function displayResults(sessionId: string) {
  console.clear();
  p.note('PIPELINE RESULTS', 'Summary');
  const intentResult = repo.getIntentResult(sessionId);
  if (intentResult) {
    const data = JSON.parse(intentResult.resultJson);
    console.log(pc.cyan('\n[*] Intent Analysis'));
    console.log(`- Intent: ${pc.bold(data.intent)}`);
    console.log(`- Category: ${pc.bold(data.category)}`);
    console.log(`- Topics Extracted:`);
    console.table(data.topics.map((t: string) => ({ Topic: t })));
  }

  const expansionResult = repo.getExpansionResult(sessionId);
  if (expansionResult) {
    const data = JSON.parse(expansionResult.resultJson);
    console.log(pc.cyan('\n[*] Top Expanded Topics'));
    const topCandidates = data.candidates.map((c: any) => ({
      Query: c.query,
      Source: c.source,
      Signal: c.trendSignal || '-',
      Score: c.semanticScore
    }));
    console.table(topCandidates);
  } else {
    console.log(pc.cyan('\n[*] Top Expanded Topics'));
    console.log('No expansion results found.');
  }

  const collectionResults = repo.getCollectorResultsBySession(sessionId);
  if (collectionResults && collectionResults.length > 0) {
    console.log(pc.cyan('\n[*] Collected Data Summary'));
    const summary = collectionResults.map((r) => {
      return {
        Topic: r.query,
        Platform: r.platform,
        ItemsCollected: r.resultCount
      };
    });
    console.table(summary);
  } else {
    console.log(pc.cyan('\n[*] Collected Data Summary'));
    console.log(pc.yellow('[!] No collection results found in the database for this session.'));
    console.log(pc.dim('   (This usually happens if external APIs rate-limited the requests or returned 0 results).'));
  }

  const tokenUsage = repo.getTokenUsageBySession(sessionId);
  if (tokenUsage && tokenUsage.length > 0) {
    console.log(pc.cyan('\n[*] Token Usage Summary'));
    let totalPrompt = 0;
    let totalOutput = 0;
    let totalAll = 0;

    const summary = tokenUsage.map((u) => {
      totalPrompt += u.promptTokens;
      totalOutput += u.outputTokens;
      totalAll += u.totalTokens;
      return {
        Stage: u.stage,
        Model: u.model,
        Prompt: u.promptTokens,
        Output: u.outputTokens,
        Total: u.totalTokens
      };
    });

    summary.push({
      Stage: pc.bold('TOTAL'),
      Model: '-',
      Prompt: totalPrompt as any,
      Output: totalOutput as any,
      Total: totalAll as any
    });

    console.table(summary);
  }
}

async function viewCollectedData(sessionId: string) {
  const collectionResults = repo.getCollectorResultsBySession(sessionId);
  if (!collectionResults || collectionResults.length === 0) {
    p.log.warn('No collection results found for this session.');
    await pause();
    return;
  }

  while (true) {
    const options = collectionResults.map((r, idx) => ({
      value: idx,
      label: `[${r.platform.toUpperCase()}] Topic: "${r.query}" (${r.resultCount} items)`
    }));
    options.push({ value: -1, label: pc.red('Back') });

    const choice = await p.select({
      message: 'Collected Data (Deep Dive) - Select a result to inspect:',
      options,
    });

    if (p.isCancel(choice) || choice === -1) return;

    console.clear();
    const selected = collectionResults[choice as number];
    p.note(`Platform: ${selected.platform.toUpperCase()}\nTopic: "${selected.query}"`, 'Results');

    try {
      const data = JSON.parse(selected.resultJson);
      if (['reddit', 'youtube', 'hackerNews'].includes(selected.platform)) {
        console.log(pc.cyan(`\nFound ${data.length} items:\n`));
        data.forEach((item: any, idx: number) => {
          console.log(pc.bold(pc.yellow(`[Item ${idx + 1}] Source: ${selected.platform.toUpperCase()}`)));

          const title = item.title || '';
          if (title) console.log(`Title: ${pc.white(pc.bold(title))}`);

          let url = item.url || item.permalink || 'N/A';
          if (selected.platform === 'reddit' && !url.startsWith('http')) {
            url = 'https://reddit.com' + url;
          }
          console.log(`URL: ${pc.blue(url)}`);

          let score = item.score ?? item.points ?? item.viewsText ?? '0';
          let comments = item.comments ?? '0';
          console.log(`Score/Views: ${score} | Comments: ${comments}`);

          let content = item.body || item.description || item.text || '';
          if (content) {
            if (content.length > 200) {
              content = content.substring(0, 200) + '...';
            }
            const wrappedText = wrapAnsi(content, 80).split('\n');
            wrappedText.forEach((line: string) => console.log(`  ${pc.gray(line)}`));
          }
          console.log();
        });
      } else if (selected.platform === 'googleTrends') {
        data.forEach((m: any) => {
          console.log(pc.bold(`\nMethod: ${m.method}`));
          if (m.error) console.log(pc.red(`Error: ${m.error}`));
          if (m.relatedQueries) {
            console.log(pc.cyan('Top Queries:'));
            console.table(m.relatedQueries.top.slice(0, 5).map((q: any) => ({ Query: q.query, Value: q.value })));
            console.log(pc.cyan('Rising Queries:'));
            console.table(m.relatedQueries.rising.slice(0, 5).map((q: any) => ({ Query: q.query, Value: q.value })));
          }
          if (m.timelineData) {
            console.log(`Timeline Points: ${m.timelineData.length}`);
          }
        });
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
    } catch (err: any) {
      p.log.error(`Failed to parse or display data: ${err.message}`);
    }

    await pause();
  }
}

async function viewPythonResult(sessionId: string) {
  const pythonResult = repo.getPythonResult(sessionId);
  if (!pythonResult) {
    p.log.warn('No Python pipeline results found for this session.');
    await pause();
    return;
  }

  try {
    console.clear();
    const data = JSON.parse(pythonResult.resultJson);
    p.note(`Topic: ${data.topic || 'Unknown'}\nTrend Catchers: ${data.trend_catchers?.length || 0}`, 'PYTHON PIPELINE RESULTS');

    if (data.trend_catchers && data.trend_catchers.length > 0) {
      console.log(pc.cyan(pc.bold('\n┌── TREND CATCHERS ' + '─'.repeat(60))));
      data.trend_catchers.forEach((tc: any, i: number) => {
        if (i > 0) console.log(pc.cyan('├' + '─'.repeat(78)));
        console.log(`│ ${pc.bgGreen(pc.black(` #${i + 1} `))} ${pc.bold(pc.green(tc.trend))}`);
        console.log(`│ ${pc.gray('├─')} ${pc.bold('Type:')}       ${pc.magenta(tc.trend_type || 'mainstream').padEnd(14)} ${pc.gray('|')}  ${pc.bold('Confidence:')} ${pc.yellow(tc.confidence || 'medium')}`);
        console.log(`│ ${pc.gray('├─')} ${pc.bold('Platform:')}   ${pc.yellow(tc.platform.padEnd(14))} ${pc.gray('|')}  ${pc.bold('Status:')}     ${pc.magenta(tc.status)}`);
        console.log(`│ ${pc.gray('├─')} ${pc.bold('Format:')}     ${pc.cyan(tc.format)}`);
        // Wrap angle nicely
        const wrappedAngle = wrapAnsi(tc.angle || '', 60).split('\n');
        wrappedAngle.forEach((line: string, lineIdx: number) => {
          if (lineIdx === 0) {
            console.log(`│ ${pc.gray('├─')} ${pc.bold('Angle:')}      ${pc.white(line)}`);
          } else {
            console.log(`│               ${pc.white(line)}`);
          }
        });

        // Wrap suggested content nicely
        const wrappedContent = wrapAnsi(tc.suggested_content || '', 60).split('\n');
        wrappedContent.forEach((line: string, lineIdx: number) => {
          if (lineIdx === 0) {
            console.log(`│ ${pc.gray('└─')} ${pc.bold('Content:')}    ${pc.italic(line)}`);
          } else {
            console.log(`│               ${pc.italic(line)}`);
          }
        });
      });
      console.log(pc.cyan('└' + '─'.repeat(78) + '\n'));
    }

    if (data.raw_analysis) {
      const raw = data.raw_analysis;
      if (raw.top_pain_points && raw.top_pain_points.length > 0) {
        console.log(pc.magenta(pc.bold('┌── TOP PAIN POINTS ' + '─'.repeat(59))));
        raw.top_pain_points.forEach((pp: any, i: number) => {
          const ppLines = wrapAnsi(pp.pain_point || pp.summary || '', 70).split('\n');
          ppLines.forEach((line: string, j: number) => {
            if (j === 0) {
              console.log(`│ ${pc.red(i + 1 + '.')} ${line}`);
            } else {
              console.log(`│    ${line}`);
            }
          });
        });
        console.log(pc.magenta('└' + '─'.repeat(78) + '\n'));
      }

      if (raw.top_feature_requests && raw.top_feature_requests.length > 0) {
        console.log(pc.blue(pc.bold('┌── TOP FEATURE REQUESTS ' + '─'.repeat(54))));
        raw.top_feature_requests.forEach((fr: any, i: number) => {
          const frLines = wrapAnsi(fr.feature_request || fr.summary || '', 70).split('\n');
          frLines.forEach((line: string, j: number) => {
            if (j === 0) {
              console.log(`│ ${pc.cyan(i + 1 + '.')} ${line}`);
            } else {
              console.log(`│    ${line}`);
            }
          });
        });
        console.log(pc.blue('└' + '─'.repeat(78) + '\n'));
      }

      if (raw.stats) {
        console.log(pc.gray(pc.bold('┌── STATS ' + '─'.repeat(69))));
        console.log(`│ ${pc.bold('Total Evidence:')} ${raw.stats.total_evidence}`);
        console.log(`│ ${pc.bold('Sources:')}        ${(raw.stats.sources || []).join(', ')}`);
        console.log(pc.gray('└' + '─'.repeat(78) + '\n'));
      }
    }

    while (true) {
      const choice = await p.select({
        message: 'Python Pipeline Results Menu',
        options: [
          { value: 'view_trend_posts', label: 'View Posts for a Trend Catcher' },
          { value: 'view_signal_posts', label: 'View Posts for a Signal' },
          { value: 'back', label: pc.red('Back') }
        ]
      });

      if (p.isCancel(choice) || choice === 'back') break;

      if (choice === 'view_trend_posts' && data.trend_catchers) {
        const tcChoice = await p.select({
          message: 'Select a Trend Catcher to view posts:',
          options: [
            ...data.trend_catchers.map((tc: any, idx: number) => ({
              value: tc,
              label: `${idx + 1}. ${tc.trend} (${tc.evidence_ids?.length || 0} posts)`
            })),
            { value: 'cancel', label: pc.red('Cancel') }
          ]
        });
        if (!p.isCancel(tcChoice) && tcChoice !== 'cancel') {
          displayPosts((tcChoice as any).evidence_ids, data.posts_by_id);
          await pause();
        }
      } else if (choice === 'view_signal_posts' && data.raw_analysis?.signals) {
        const sigChoice = await p.select({
          message: 'Select a Signal to view posts:',
          options: [
            ...data.raw_analysis.signals.map((sig: any, idx: number) => ({
              value: sig,
              label: `${idx + 1}. ${sig.summary || sig.signal_id} (${sig.evidence_ids?.length || 0} posts)`
            })),
            { value: 'cancel', label: pc.red('Cancel') }
          ]
        });
        if (!p.isCancel(sigChoice) && sigChoice !== 'cancel') {
          displayPosts((sigChoice as any).evidence_ids, data.posts_by_id);
          await pause();
        }
      } else {
        p.log.warn('No data available for this selection.');
        await pause();
      }
    }
  } catch (err: any) {
    p.log.error(`Failed to parse or display python data: ${err.message}`);
    await pause();
  }
}

function displayPosts(evidenceIds: string[], postsById: any) {
  if (!evidenceIds || evidenceIds.length === 0) {
    p.log.warn('No posts mapped to this item.');
    return;
  }
  if (!postsById) {
    p.log.warn('Post data was not saved in this session (missing posts_by_id).');
    return;
  }
  const posts = evidenceIds.map(id => postsById[id]).filter(p => !!p);
  if (posts.length === 0) {
    p.log.warn('Could not find corresponding posts data.');
    return;
  }
  console.clear();
  console.log(pc.cyan(`\nFound ${posts.length} posts:\n`));
  posts.forEach((p: any, idx: number) => {
    console.log(pc.bold(pc.yellow(`[Post ${idx + 1}] Source: ${p.source?.toUpperCase() || 'UNKNOWN'}`)));
    console.log(`URL: ${pc.blue(p.url || 'N/A')}`);
    console.log(`Score/Views: ${p.score} | Comments: ${p.num_comments}`);

    let textToDisplay = p.text || '';
    if (textToDisplay.length > 200) {
      textToDisplay = textToDisplay.substring(0, 200) + '...';
    }

    const wrappedText = wrapAnsi(textToDisplay, 80).split('\n');
    wrappedText.forEach((line: string) => console.log(`  ${pc.gray(line)}`));
    console.log();
  });
}

async function manageSession(session: Session) {
  while (true) {
    const date = new Date(session.createdAt).toLocaleString();
    const choice = await p.select({
      message: `Session Menu: "${session.query}" (${date})`,
      options: [
        { value: 'summary', label: 'View Summary (Stats)' },
        { value: 'deepdive', label: 'Deep Dive Collected Data' },
        { value: 'python', label: 'View Trend Catchers (Final Result)' },
        { value: 'resume', label: 'Resume Pipeline' },
        { value: 'delete', label: pc.red('Delete Session') },
        { value: 'back', label: 'Back to Sessions List' },
      ],
    });

    if (p.isCancel(choice) || choice === 'back') return;

    if (choice === 'summary') {
      displayResults(session.id);
      await pause();
    } else if (choice === 'deepdive') {
      await viewCollectedData(session.id);
    } else if (choice === 'python') {
      await viewPythonResult(session.id);
    } else if (choice === 'resume') {
      p.log.info('--- Resume Pipeline ---');
      const stageOptions = [
        { value: 'intent', label: 'Intent Analysis' },
        { value: 'expansion', label: 'Topic Expansion' },
        { value: 'collection', label: 'Data Collection' },
        { value: 'python', label: 'Python Pipeline' }
      ];

      const startStageInput = await p.select({
        message: 'Start stage',
        options: stageOptions,
        initialValue: 'intent'
      });
      if (p.isCancel(startStageInput)) continue;

      const endStageInput = await p.select({
        message: 'End stage',
        options: stageOptions,
        initialValue: 'python'
      });
      if (p.isCancel(endStageInput)) continue;

      let pythonStart = 0;
      let pythonEnd = 9;
      if (startStageInput === 'python' || endStageInput === 'python') {
        const ps = await p.text({ message: 'Python pipeline start stage (0-9)', initialValue: '0' });
        if (p.isCancel(ps)) continue;
        pythonStart = parseInt(ps as string, 10);
        if (isNaN(pythonStart)) pythonStart = 0;

        const pe = await p.text({ message: 'Python pipeline end stage (0-9)', initialValue: '9' });
        if (p.isCancel(pe)) continue;
        pythonEnd = parseInt(pe as string, 10);
        if (isNaN(pythonEnd)) pythonEnd = 9;
      }

      const s = p.spinner();
      s.start('Resuming pipeline...');
      try {
        await orchestrator.runPipeline(session.userId, 'Unknown', session.query, {
          sessionId: session.id,
          startStage: startStageInput as any,
          endStage: endStageInput as any,
          pythonStartStage: pythonStart,
          pythonEndStage: pythonEnd,
          topK: 10,
          reddit: { limit: 10, sort: 'relevance', time: 'month' },
          youtube: {
            limit: 10,
            region: 'US',
            filters: [
              { category: 'uploadDate', label: 'This year' },
              { category: 'type', label: 'Video' }
            ]
          },
          hackerNews: {
            limit: 10,
            minPoints: 2,
            after: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          },
          onLog: (msg) => s.message(msg),
        });
        s.stop(pc.green('Pipeline resumed successfully.'));
        await pause();
      } catch (err: any) {
        s.stop(pc.red(`Pipeline resume failed: ${err.message}`));
        await pause();
      }
    } else if (choice === 'delete') {
      const challenge = uniqueNamesGenerator({
        dictionaries: [adjectives, colors, animals],
        separator: '-',
        length: 3,
      });
      p.log.warn(`WARNING: You are about to permanently delete the session for "${session.query}".\nAll associated intents, expansions, and collected data will be erased.`);
      const answer = await p.text({
        message: `To confirm deletion, type the following code [ ${pc.bold(challenge)} ]: `
      });
      if (p.isCancel(answer)) continue;

      if ((answer as string).trim() === challenge) {
        repo.deleteSession(session.id);
        p.log.success('Session successfully deleted.');
        break; // Return to previous menu
      } else {
        p.log.error('Confirmation code did not match. Deletion cancelled.');
        await pause();
      }
    }
  }
}

async function viewSessionsMenu(user: User) {
  while (true) {
    const sessions = repo.getSessionsByUser(user.id);
    if (sessions.length === 0) {
      p.log.info('No past sessions found.');
      return;
    }

    const options = sessions.map((s) => {
      const date = new Date(s.createdAt).toLocaleString();
      return {
        value: s,
        label: `[${date}] ${s.query}`
      };
    });
    options.push({ value: null as any, label: pc.yellow('Back to Main Menu') });

    const selected = await p.select({
      message: 'Past Sessions',
      options,
    });

    if (p.isCancel(selected) || !selected) return;

    await manageSession(selected as Session);
  }
}

async function upgradeMenu() {
  console.clear();
  p.intro(pc.bgBlue(pc.black(' ⬆ UPGRADE MANAGER ')));
  const manager = new UpgradeManager();
  const s = p.spinner();

  s.start('Checking for updates...');
  let updateResult;
  try {
    updateResult = await manager.checkForUpdate();
  } catch (err: any) {
    s.stop(pc.red(`Failed to check for updates: ${err.message}`));
    await pause();
    return;
  }
  s.stop('Update check complete.');

  if (!updateResult.updateAvailable) {
    p.log.success(`You are running the latest version: v${updateResult.currentVersion}`);
    await pause();
    return;
  }

  p.log.info(`Update available! v${updateResult.currentVersion} ➔ v${updateResult.latestVersion}`);
  if (updateResult.releaseInfo?.changelog) {
    p.note(updateResult.releaseInfo.changelog, 'Changelog');
  }

  const confirmUpdate = await p.confirm({
    message: 'Do you want to download and install this update now?',
    initialValue: true,
  });

  if (p.isCancel(confirmUpdate) || !confirmUpdate) return;

  const downloadSpinner = p.spinner();
  downloadSpinner.start('Downloading update...');

  let archivePath = '';
  try {
    if (updateResult.releaseInfo) {
      archivePath = await manager.downloadFullRelease(updateResult.releaseInfo);
    }
    downloadSpinner.stop(pc.green('Download complete.'));
  } catch (err: any) {
    downloadSpinner.stop(pc.red(`Download failed: ${err.message}`));
    await pause();
    return;
  }

  const installSpinner = p.spinner();
  installSpinner.start('Applying update and running post-install hooks (this may take a minute)...');
  try {
    await manager.applyUpdate(archivePath, updateResult.latestVersion);
    installSpinner.stop(pc.green(`Successfully updated to v${updateResult.latestVersion}!`));
    p.log.info('Please restart the application to use the new version.');
    process.exit(0);
  } catch (err: any) {
    installSpinner.stop(pc.red(`Update failed: ${err.message}`));
    p.log.warn('The system automatically rolled back to the previous version.');
    await pause();
  }
}


async function main() {
  UpgradeManager.recoverIfInterrupted();
  console.clear();
  console.log(pc.magenta(banner));
  // p.intro(`${pc.bgCyan(pc.black(' TRINITY TRENDS '))} A Pretty Trends Analyzer`);

  p.note('Use [Enter] to select, [Arrow Keys] to navigate, and [Escape] to go back.', 'Navigation Info');

  const emailInput = await p.text({
    message: 'Enter your email to login:',
    validate: (value: string | undefined) => {
      if (!value || !value.trim()) return 'Email is required';
      if (!value.includes('@')) return 'Invalid email';
    }
  });

  if (p.isCancel(emailInput)) {
    exitApp();
  }

  const userEmail = (emailInput as string).trim();
  let user = repo.getUserByEmail(userEmail);

  if (!user) {
    p.log.info("User not found. Let's create a new profile.");
    const nameInput = await p.text({
      message: 'Enter your name:',
      validate: (value: string | undefined) => {
        if (!value || !value.trim()) return 'Name is required';
      }
    });

    if (p.isCancel(nameInput)) {
      exitApp();
    }

    user = repo.createUser({ email: userEmail, name: (nameInput as string).trim() });
    p.log.success(`Welcome, ${user.name}! Profile created.`);
  } else {
    p.log.success(`Welcome back, ${user.name}!`);
  }

  while (true) {
    const choice = await p.select({
      message: `MAIN MENU ${pc.dim(`(v${getCurrentVersion()})`)}`,
      options: [
        { value: 'new', label: 'Run New Search Pipeline' },
        { value: 'past', label: 'View Past Sessions' },
        { value: 'upgrade', label: 'Check for Updates' },
        { value: 'exit', label: 'Exit' },
      ],
    });

    if (p.isCancel(choice) || choice === 'exit') {
      exitApp();
    }

    if (choice === 'new') {
      const query = await p.text({
        message: 'Enter your new search query:',
        validate: (value: string | undefined) => {
          if (!value || !value.trim()) return 'Query is required';
        }
      });
      if (p.isCancel(query)) continue;

      const stageOptions = [
        { value: 'intent', label: 'Intent Analysis' },
        { value: 'expansion', label: 'Topic Expansion' },
        { value: 'collection', label: 'Data Collection' },
        { value: 'python', label: 'Python Pipeline' }
      ];

      const startStageInput = await p.select({
        message: 'Start stage',
        options: stageOptions,
        initialValue: 'intent'
      });
      if (p.isCancel(startStageInput)) continue;

      const endStageInput = await p.select({
        message: 'End stage',
        options: stageOptions,
        initialValue: 'python'
      });
      if (p.isCancel(endStageInput)) continue;

      let pythonStart = 0;
      let pythonEnd = 9;
      if (startStageInput === 'python' || endStageInput === 'python') {
        const ps = await p.text({ message: 'Python pipeline start stage (0-9)', initialValue: '0' });
        if (p.isCancel(ps)) continue;
        pythonStart = parseInt(ps as string, 10);
        if (isNaN(pythonStart)) pythonStart = 0;

        const pe = await p.text({ message: 'Python pipeline end stage (0-9)', initialValue: '9' });
        if (p.isCancel(pe)) continue;
        pythonEnd = parseInt(pe as string, 10);
        if (isNaN(pythonEnd)) pythonEnd = 9;
      }

      const s = p.spinner();
      s.start('Running pipeline...');
      try {
        const sessionId = await orchestrator.runPipeline(user.email!, user.name, (query as string).trim(), {
          startStage: startStageInput as any,
          endStage: endStageInput as any,
          pythonStartStage: pythonStart,
          pythonEndStage: pythonEnd,
          topK: 10,
          reddit: { limit: 10, sort: 'relevance', time: 'month' },
          youtube: {
            limit: 10,
            region: 'US',
            filters: [
              { category: 'uploadDate', label: 'This year' },
              { category: 'type', label: 'Video' }
            ]
          },
          hackerNews: {
            limit: 10,
            minPoints: 2,
            after: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          },
          onLog: (msg) => s.message(msg),
        });

        s.stop(pc.green('Pipeline complete!'));
        displayResults(sessionId);
        await pause();
        const session = repo.getSessionById(sessionId);
        if (session) await manageSession(session);
      } catch (err: any) {
        s.stop(pc.red(`Pipeline failed: ${err.message}`));
        await pause();
      }
    } else if (choice === 'past') {
      await viewSessionsMenu(user);
    } else if (choice === 'upgrade') {
      await upgradeMenu();
    }
  }
}

main().catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
