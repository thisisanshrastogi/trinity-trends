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
  const ascii = figlet.textSync('Adios!', { font: 'ANSI Shadow' });
  console.log(pc.magenta(ascii));

  const quote = quotes.getQuote();
  const separator = pc.cyan('✧ '.repeat(25));

  console.log(separator);
  console.log(pc.italic(`  "${quote.text}"`));
  console.log(pc.gray(`       — ${quote.author}`));
  console.log(separator + '\n');

  process.exit(0);
}

// Helper to pause
async function pause() {
  await p.text({ message: 'Press Enter to continue...', placeholder: '', defaultValue: '' });
}

function displayResults(sessionId: string) {
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
    console.log(pc.cyan('\n[*] Top Expanded Topics (Sample)'));
    const topCandidates = data.candidates.slice(0, 10).map((c: any) => ({
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

    const selected = collectionResults[choice as number];
    p.note(`Platform: ${selected.platform.toUpperCase()}\nTopic: "${selected.query}"`, 'Results');

    try {
      const data = JSON.parse(selected.resultJson);
      if (selected.platform === 'reddit') {
        console.table(data.map((p: any) => ({
          Title: p.title ? p.title.substring(0, 50) + '...' : '',
          Subreddit: p.subreddit,
          Score: p.score,
          Comments: p.comments
        })));
      } else if (selected.platform === 'youtube') {
        console.table(data.map((v: any) => ({
          Title: v.title ? v.title.substring(0, 50) + '...' : '',
          Channel: v.channelName,
          Views: v.viewsText,
          Length: v.duration
        })));
      } else if (selected.platform === 'hackerNews') {
        console.table(data.map((p: any) => ({
          Title: (p.title || p.text || '').substring(0, 50) + '...',
          Type: p.type,
          Author: p.author,
          Points: p.points,
          Comments: p.comments
        })));
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
    const data = JSON.parse(pythonResult.resultJson);
    p.note(`Topic: ${data.topic || 'Unknown'}\nTrend Catchers: ${data.trend_catchers?.length || 0}`, 'PYTHON PIPELINE RESULTS');

    if (data.trend_catchers && data.trend_catchers.length > 0) {
      console.log(pc.cyan(pc.bold('\n┌── TREND CATCHERS ' + '─'.repeat(60))));
      data.trend_catchers.forEach((tc: any, i: number) => {
        if (i > 0) console.log(pc.cyan('├' + '─'.repeat(78)));
        console.log(`│ ${pc.bgGreen(pc.black(` #${i + 1} `))} ${pc.bold(pc.green(tc.trend))}`);
        console.log(`│ ${pc.gray('├─')} ${pc.bold('Platform:')} ${pc.yellow(tc.platform.padEnd(10))} ${pc.gray('|')}  ${pc.bold('Status:')} ${pc.magenta(tc.status)}`);
        console.log(`│ ${pc.gray('├─')} ${pc.bold('Format:')}   ${pc.cyan(tc.format)}`);
        console.log(`│ ${pc.gray('├─')} ${pc.bold('Angle:')}    ${pc.white(tc.angle)}`);

        // Wrap suggested content nicely
        const wrappedContent = wrapAnsi(tc.suggested_content || '', 60).split('\n');
        wrappedContent.forEach((line: string, lineIdx: number) => {
          if (lineIdx === 0) {
            console.log(`│ ${pc.gray('└─')} ${pc.bold('Content:')}  ${pc.italic(line)}`);
          } else {
            console.log(`│             ${pc.italic(line)}`);
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
  } catch (err: any) {
    p.log.error(`Failed to parse or display python data: ${err.message}`);
  }

  await pause();
}

async function manageSession(session: Session) {
  while (true) {
    const date = new Date(session.createdAt).toLocaleString();
    const choice = await p.select({
      message: `Session Menu: "${session.query}" (${date})`,
      options: [
        { value: 'summary', label: 'View Summary (Intent, Expansion & Collection Stats)' },
        { value: 'deepdive', label: 'Deep Dive into Collected Data' },
        { value: 'python', label: 'View Python Pipeline Result' },
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
      const stages = ['intent', 'expansion', 'collection', 'python'];
      const startStageInput = await p.select({
        message: 'Start stage',
        options: stages.map(s => ({ value: s, label: s })),
        initialValue: 'intent'
      });
      if (p.isCancel(startStageInput)) continue;

      const endStageInput = await p.select({
        message: 'End stage',
        options: stages.map(s => ({ value: s, label: s })),
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
          topK: 5,
          reddit: { limit: 10, sort: 'relevance', time: 'month' },
          youtube: {
            limit: 10,
            region: 'US',
            filters: [
              { category: 'uploadDate', label: 'This month' },
              { category: 'features', label: 'HD' }
            ]
          },
          hackerNews: {
            limit: 10,
            sort: 'relevance',
          },
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

async function main() {
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
      message: 'MAIN MENU',
      options: [
        { value: 'new', label: 'Run New Search Pipeline' },
        { value: 'past', label: 'View Past Sessions' },
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

      const stages = ['intent', 'expansion', 'collection', 'python'];
      const startStageInput = await p.select({
        message: 'Start stage',
        options: stages.map(s => ({ value: s, label: s })),
        initialValue: 'intent'
      });
      if (p.isCancel(startStageInput)) continue;

      const endStageInput = await p.select({
        message: 'End stage',
        options: stages.map(s => ({ value: s, label: s })),
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
          topK: 5,
          reddit: { limit: 10, sort: 'relevance', time: 'month' },
          youtube: {
            limit: 10,
            region: 'US',
            filters: [
              { category: 'uploadDate', label: 'This month' }

            ]
          },
          hackerNews: {
            limit: 10,
            sort: 'relevance',
          },
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
    }
  }
}

main().catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
