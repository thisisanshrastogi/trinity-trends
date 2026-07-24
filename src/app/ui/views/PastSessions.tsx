import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { User, Session } from '../../../storage/storage.types.js';
import { SqliteRepository } from '../../../storage/sqlite/sqlite.repository.js';
import { PostViewer, PostData } from '../components/PostViewer.js';
import pc from 'picocolors';
import TextInput from 'ink-text-input';
import { uniqueNamesGenerator, adjectives, colors, animals } from 'unique-names-generator';

interface PastSessionsProps {
  user: User;
  onBack: () => void;
  initialSessionId?: string;
}

export const PastSessions: React.FC<PastSessionsProps> = ({ user, onBack, initialSessionId }) => {
  const repo = useMemo(() => new SqliteRepository(), []);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session | null>(() => {
    if (initialSessionId) return repo.getSessionById(initialSessionId);
    return null;
  });
  
  const [view, setView] = useState<'list' | 'menu' | 'summary' | 'deepdive_topics' | 'deepdive_posts' | 'python' | 'python_trend_select' | 'python_signal_select' | 'python_posts' | 'tokens' | 'delete_confirm'>(initialSessionId ? 'python' : 'list');
  const [topics, setTopics] = useState<any[]>([]);
  const [selectedTopicIdx, setSelectedTopicIdx] = useState<number>(-1);
  const [posts, setPosts] = useState<PostData[]>([]);
  const [selectedPostIdx, setSelectedPostIdx] = useState<number>(0);
  const [deleteChallenge, setDeleteChallenge] = useState('');
  const [deleteInput, setDeleteInput] = useState('');

  useEffect(() => {
    setSessions(repo.getSessionsByUser(user.id));
  }, [user.id, repo, view]);

  const handleBack = () => {
    if (view === 'list') onBack();
    else if (view === 'menu') {
      if (initialSessionId) onBack();
      else setView('list');
    }
    else if (view === 'deepdive_topics') setView('menu');
    else if (view === 'deepdive_posts') setView('deepdive_topics');
    else if (view === 'python_trend_select' || view === 'python_signal_select' || view === 'python_posts') setView('python');
    else if (view === 'delete_confirm') setView('menu');
    else {
      if (view === 'python' && initialSessionId) onBack();
      else setView('menu'); // for summary, python, tokens
    }
  };

  useInput((input, key) => {
    if (key.escape) handleBack();
  });

  if (view === 'list') {
    if (sessions.length === 0) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text color="yellow">No past sessions found.</Text>
          <Box marginTop={1}>
            <SelectInput items={[{label: pc.red('« Back'), value: 'back'}]} onSelect={onBack} />
          </Box>
        </Box>
      );
    }

    const items = sessions.map(s => ({
      label: `[${new Date(s.createdAt).toLocaleString()}] ${s.query}`,
      value: s.id
    }));
    items.push({ label: 'Back to Main Menu', value: 'back' });

    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan" bold>--- Past Sessions ---</Text>
        <SelectInput 
          items={items} 
          onSelect={(item) => {
            if (item.value === 'back') onBack();
            else {
              const s = sessions.find(x => x.id === item.value);
              if (s) {
                setSelectedSession(s);
                setView('menu');
              }
            }
          }} 
        />
      </Box>
    );
  }

  if (view === 'menu' && selectedSession) {
    const items = [
      { label: pc.cyan('☰ View Summary'), value: 'summary' },
      { label: pc.blue('⚲ Deep Dive Collected Data'), value: 'deepdive_topics' },
      { label: pc.magenta('★ View Python Trend Catchers'), value: 'python' },
      { label: pc.green('∑ Token Usage'), value: 'tokens' },
      { label: pc.gray('▶ Resume Pipeline (Stub)'), value: 'resume' },
      { label: pc.red('✖ Delete Session'), value: 'delete' },
      { label: pc.yellow('« Back to Sessions List'), value: 'list' }
    ];

    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan" bold>Session: "{selectedSession.query}"</Text>
        <Box marginY={1}>
          <SelectInput 
            items={items}
            onSelect={(item) => {
              if (item.value === 'list') setView('list');
              else if (item.value === 'delete') {
                const challenge = uniqueNamesGenerator({
                  dictionaries: [adjectives, colors, animals],
                  separator: '-',
                  length: 3,
                });
                setDeleteChallenge(challenge);
                setDeleteInput('');
                setView('delete_confirm');
              }
              else if (item.value === 'deepdive_topics') {
                const results = repo.getCollectorResultsBySession(selectedSession.id);
                setTopics(results);
                setView('deepdive_topics');
              }
              else {
                setView(item.value as any);
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (view === 'delete_confirm') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red" bold>WARNING: You are about to permanently delete the session for "{selectedSession?.query}".</Text>
        <Text color="red">All associated intents, expansions, and collected data will be erased.</Text>
        
        <Box marginY={1} flexDirection="column">
          <Text>To confirm deletion, type the following code [ <Text color="yellow" bold>{deleteChallenge}</Text> ]:</Text>
          <Box marginLeft={2} marginTop={1}>
            <Text color="green">❯ </Text>
            <TextInput 
              value={deleteInput} 
              onChange={setDeleteInput} 
              onSubmit={() => {
                if (deleteInput.trim() === deleteChallenge) {
                  repo.deleteSession(selectedSession!.id);
                  setView('list');
                }
              }} 
            />
          </Box>
        </Box>
        <Box marginTop={1}>
          <Text color="gray">[Enter] to confirm | [Esc] to cancel</Text>
        </Box>
      </Box>
    );
  }

  if (view === 'deepdive_topics') {
    if (topics.length === 0) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text color="yellow">No collection results found for this session.</Text>
          <Box marginTop={1}>
            <SelectInput items={[{label: pc.red('« Back'), value: 'back'}]} onSelect={() => setView('menu')} />
          </Box>
        </Box>
      );
    }

    const items = topics.map((t, idx) => ({
      label: `[${t.platform.toUpperCase()}] "${t.query}" (${t.resultCount} items)`,
      value: idx.toString()
    }));
    items.push({ label: 'Back', value: 'back' });

    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan" bold>Collected Topics</Text>
        <SelectInput 
          items={items}
          onSelect={(item) => {
            if (item.value === 'back') setView('menu');
            else {
              const idx = parseInt(item.value, 10);
              const selected = topics[idx];
              try {
                const rawData = JSON.parse(selected.resultJson);
                const mappedPosts: PostData[] = Array.isArray(rawData) ? rawData.map(p => ({
                  source: selected.platform,
                  url: p.url || p.permalink || '',
                  text: p.body || p.description || p.text || p.title || p.caption || '',
                  transcript: p.transcript || undefined,
                  score: p.score ?? p.points,
                  views: p.views ?? p.view_count ?? (p.viewsText ? parseInt(p.viewsText.replace(/[^0-9]/g, '')) : undefined),
                  comments: p.comments ?? p.num_comments ?? p.comment_count,
                  likes: p.likes ?? p.like_count,
                  shares: p.shares
                })) : [];
                setPosts(mappedPosts);
                setSelectedTopicIdx(idx);
                setSelectedPostIdx(0);
                setView('deepdive_posts');
              } catch (e) {
                // Ignore parse errors
              }
            }
          }}
        />
      </Box>
    );
  }

  if (view === 'deepdive_posts') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan" bold>Posts for Topic: {topics[selectedTopicIdx]?.query}</Text>
        <Box marginY={1} flexDirection="row">
          <Box width="30%" borderStyle="single" marginRight={1} flexDirection="column">
            <Box marginBottom={1}>
              <Text color="gray" dimColor>Use ↑/↓ to scroll ({posts.length} posts)</Text>
            </Box>
            <SelectInput 
              limit={10}
              items={[
                { label: '< Back', value: 'back' },
                ...posts.map((p, idx) => ({ label: `Post ${idx + 1}`, value: idx.toString() }))
              ]}
              onHighlight={(item) => {
                if (item.value !== 'back') setSelectedPostIdx(parseInt(item.value, 10));
              }}
              onSelect={(item) => {
                if (item.value === 'back') setView('deepdive_topics');
              }}
            />
          </Box>
          <Box width="70%">
            {posts[selectedPostIdx] ? (
              <PostViewer post={posts[selectedPostIdx]} isActive={true} />
            ) : (
              <Text>No posts available</Text>
            )}
          </Box>
        </Box>
      </Box>
    );
  }

  if (view === 'summary') {
    const intentResult = repo.getIntentResult(selectedSession!.id);
    const intentData = intentResult ? JSON.parse(intentResult.resultJson) : null;
    
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan" bold>--- Pipeline Summary ---</Text>
        <Box marginY={1} flexDirection="column">
          {intentData ? (
            <>
              <Text color="green">Intent: <Text color="white">{intentData.intent}</Text></Text>
              <Text color="green">Category: <Text color="white">{intentData.category}</Text></Text>
              <Text color="green">Topics Extracted: <Text color="white">{intentData.topics.join(', ')}</Text></Text>
            </>
          ) : (
            <Text color="yellow">No intent data available.</Text>
          )}
        </Box>
        <Box marginTop={1}>
          <SelectInput items={[{label: pc.red('« Back'), value: 'back'}]} onSelect={() => setView('menu')} />
        </Box>
      </Box>
    );
  }

  if (view === 'python') {
    const pythonResult = repo.getPythonResult(selectedSession!.id);
    const pythonData = pythonResult ? JSON.parse(pythonResult.resultJson) : null;
    const raw = pythonData?.raw_analysis || {};

    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1} justifyContent="center">
          <Text color="magenta" bold backgroundColor="white">  TREND CATCHERS  </Text>
        </Box>
        
        <Box flexDirection="row" flexWrap="wrap">
          {pythonData?.trend_catchers && pythonData.trend_catchers.length > 0 ? (
            pythonData.trend_catchers.map((tc: any, i: number) => (
              <Box key={i} width="50%" paddingRight={1} marginBottom={1} flexDirection="column">
                <Box borderStyle="round" borderColor="magenta" paddingX={1} flexDirection="column">
                  <Text color="green" bold>#{i + 1} {tc.trend}</Text>
                  <Text>Type: <Text color="cyan">{tc.trend_type}</Text> | Conf: <Text color="yellow">{tc.confidence}</Text></Text>
                  <Text>Format: <Text color="whiteBright">{tc.format}</Text></Text>
                  <Text>Angle: <Text color="whiteBright">{tc.angle}</Text></Text>
                  <Text color="gray">{tc.suggested_content}</Text>
                </Box>
              </Box>
            ))
          ) : (
            <Text color="yellow">No trend catchers found.</Text>
          )}
        </Box>

        <Box flexDirection="row" marginTop={1}>
          <Box width="50%" flexDirection="column" borderStyle="single" borderColor="red" padding={1} marginRight={1}>
            <Text color="red" bold>TOP PAIN POINTS</Text>
            <Box flexDirection="column" marginTop={1}>
              {(raw.top_pain_points || []).slice(0, 5).map((pp: any, i: number) => (
                <Text key={i}>{pc.red(`${i+1}.`)} {pp.pain_point || pp.summary}</Text>
              ))}
              {(!raw.top_pain_points || raw.top_pain_points.length === 0) && <Text color="gray">None extracted.</Text>}
            </Box>
          </Box>

          <Box width="50%" flexDirection="column" borderStyle="single" borderColor="blue" padding={1}>
            <Text color="blue" bold>TOP FEATURE REQUESTS</Text>
            <Box flexDirection="column" marginTop={1}>
              {(raw.top_feature_requests || []).slice(0, 5).map((fr: any, i: number) => (
                <Text key={i}>{pc.cyan(`${i+1}.`)} {fr.feature_request || fr.summary}</Text>
              ))}
              {(!raw.top_feature_requests || raw.top_feature_requests.length === 0) && <Text color="gray">None extracted.</Text>}
            </Box>
          </Box>
        </Box>

        <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
          <Text color="gray" bold>STATS</Text>
          {raw.stats ? (
            <>
              <Text>Total Evidence: {raw.stats.total_evidence}</Text>
              <Text>Sources: {(raw.stats.sources || []).join(', ')}</Text>
            </>
          ) : (
             <Text color="gray">No stats available.</Text>
          )}
        </Box>
        
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow" bold>Python Pipeline Results Menu</Text>
          <SelectInput 
            items={[
              {label: 'View Posts for a Trend Catcher', value: 'trend_posts'},
              {label: 'View Posts for a Signal', value: 'signal_posts'},
              {label: pc.red('« Back to Session Menu'), value: 'back'}
            ]} 
            onSelect={(item) => {
              if (item.value === 'back') {
                if (initialSessionId) onBack();
                else setView('menu');
              }
              else if (item.value === 'trend_posts') setView('python_trend_select');
              else if (item.value === 'signal_posts') setView('python_signal_select');
            }} 
          />
        </Box>
      </Box>
    );
  }

  if (view === 'python_trend_select') {
    const pythonResult = repo.getPythonResult(selectedSession!.id);
    const pythonData = pythonResult ? JSON.parse(pythonResult.resultJson) : null;
    const items = (pythonData?.trend_catchers || []).map((tc: any, idx: number) => ({
      label: `${idx + 1}. ${tc.trend} (${tc.evidence_ids?.length || 0} posts)`,
      value: idx.toString()
    }));
    items.push({ label: pc.red('« Back'), value: 'back' });

    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan" bold>Select a Trend Catcher to view posts:</Text>
        <SelectInput 
          items={items}
          onSelect={(item) => {
            if (item.value === 'back') setView('python');
            else {
              const tc = pythonData.trend_catchers[parseInt(item.value as string, 10)];
              const mapped = (tc.evidence_ids || []).map((id: string) => pythonData.posts_by_id?.[id]).filter(Boolean).map((p: any) => ({
                source: p.source || 'UNKNOWN',
                url: p.url || '',
                text: p.text || '',
                score: p.score,
                views: p.views,
                comments: p.num_comments
              }));
              setPosts(mapped);
              setSelectedPostIdx(0);
              setView('python_posts');
            }
          }}
        />
      </Box>
    );
  }

  if (view === 'python_signal_select') {
    const pythonResult = repo.getPythonResult(selectedSession!.id);
    const pythonData = pythonResult ? JSON.parse(pythonResult.resultJson) : null;
    const items = (pythonData?.raw_analysis?.signals || []).map((sig: any, idx: number) => ({
      label: `${idx + 1}. ${sig.summary || sig.signal_id} (${sig.evidence_ids?.length || 0} posts)`,
      value: idx.toString()
    }));
    items.push({ label: pc.red('« Back'), value: 'back' });

    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan" bold>Select a Signal to view posts:</Text>
        <SelectInput 
          items={items}
          onSelect={(item) => {
            if (item.value === 'back') setView('python');
            else {
              const sig = pythonData.raw_analysis.signals[parseInt(item.value as string, 10)];
              const mapped = (sig.evidence_ids || []).map((id: string) => pythonData.posts_by_id?.[id]).filter(Boolean).map((p: any) => ({
                source: p.source || 'UNKNOWN',
                url: p.url || '',
                text: p.text || '',
                score: p.score,
                views: p.views,
                comments: p.num_comments
              }));
              setPosts(mapped);
              setSelectedPostIdx(0);
              setView('python_posts');
            }
          }}
        />
      </Box>
    );
  }

  if (view === 'python_posts') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan" bold>Trend / Signal Evidence Posts</Text>
        <Box marginY={1} flexDirection="row">
          <Box width="30%" borderStyle="single" marginRight={1} flexDirection="column">
            <Box marginBottom={1}>
              <Text color="gray" dimColor>Use ↑/↓ to scroll ({posts.length} posts)</Text>
            </Box>
            <SelectInput 
              limit={10}
              items={[
                { label: '< Back', value: 'back' },
                ...posts.map((p, idx) => ({ label: `Post ${idx + 1}`, value: idx.toString() }))
              ]}
              onHighlight={(item) => {
                if (item.value !== 'back') setSelectedPostIdx(parseInt(item.value, 10));
              }}
              onSelect={(item) => {
                if (item.value === 'back') setView('python');
              }}
            />
          </Box>
          <Box width="70%">
            {posts[selectedPostIdx] ? (
              <PostViewer post={posts[selectedPostIdx]} isActive={true} />
            ) : (
              <Text>No posts available</Text>
            )}
          </Box>
        </Box>
      </Box>
    );
  }

  if (view === 'tokens') {
    const usage = repo.getTokenUsageBySession(selectedSession!.id);
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan" bold>--- Token Usage ---</Text>
        <Box marginY={1} flexDirection="column">
          {usage.length > 0 ? usage.map((u: any, i: number) => (
             <Text key={i}>[{new Date(u.createdAt).toLocaleString()}] <Text color="magenta">{u.model}</Text> ({u.stage}): <Text color="green">{u.promptTokens}</Text> prompt / <Text color="yellow">{u.completionTokens}</Text> completion</Text>
          )) : (
            <Text color="yellow">No token usage found for this session.</Text>
          )}
        </Box>
        <Box marginTop={1}>
          <SelectInput items={[{label: pc.red('« Back'), value: 'back'}]} onSelect={() => setView('menu')} />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="yellow">This view ({view}) is currently a stub.</Text>
      <Box marginTop={1}>
        <SelectInput items={[{label: pc.red('« Back'), value: 'back'}]} onSelect={() => setView('menu')} />
      </Box>
    </Box>
  );
};
