import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import { User } from '../../../storage/storage.types.js';
import { OrchestratorClient } from '../../orchestrator.client.js';
import { ConfigManager } from '../../config.manager.js';
import { QueryAssistant } from '../../query.assistant.js';

interface RunPipelineProps {
  user: User;
  onBack: () => void;
  onComplete: (sessionId: string) => void;
}

export const RunPipeline: React.FC<RunPipelineProps> = ({ user, onBack, onComplete }) => {
  const { exit } = useApp();
  const [step, setStep] = useState<'input' | 'suggestions' | 'running' | 'paused' | 'done'>('input');
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  
  const orchestrator = React.useMemo(() => new OrchestratorClient(), []);
  const assistant = React.useMemo(() => new QueryAssistant(), []);

  // Handle graceful exit on Escape
  useInput((input, key) => {
    if (key.escape) onBack();
  });

  const handleGenerateSuggestions = async () => {
    if (!query.trim()) return;
    setIsGenerating(true);
    const results = await assistant.generateQuestions(query);
    setSuggestions(results);
    setIsGenerating(false);
    setStep('suggestions');
  };

  const handleRun = async (finalQuery: string) => {
    setQuery(finalQuery);
    setStep('running');
    setLogs([]);
    setErrorMsg('');
    
    try {
      const configManager = new ConfigManager();
      const config = configManager.load();
      
      const sessionId = await orchestrator.runPipeline(user.email!, user.name, finalQuery, {
        startStage: 'intent',
        endStage: 'python',
        pythonStartStage: 0,
        pythonEndStage: 9,
        topK: config.topK,
        reddit: { limit: config.redditLimit, sort: config.redditSort as any, time: config.redditTime as any },
        youtube: { limit: config.youtubeLimit, region: 'US', filters: [] },
        hackerNews: { limit: config.hackerNewsLimit, minPoints: config.hackerNewsMinPoints, after: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        instagram: { limit: config.instagramLimit, searchType: config.instagramSearchType as any },
        onLog: (msg) => setLogs(prev => [...prev.slice(-4), msg]), // Keep last 5 logs for pretty animation
      });
      
      onComplete(sessionId);
    } catch (err: any) {
      setErrorMsg(err.message || 'Pipeline failed');
      setStep('done');
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>--- Run New Pipeline ---</Text>
      
      {step === 'input' && (
        <Box flexDirection="column" marginY={1}>
          <Text color="yellow">Enter your base search query:</Text>
          <Box marginLeft={2}>
            <Text color="green">❯ </Text>
            <TextInput 
              value={query} 
              onChange={setQuery} 
              onSubmit={() => {
                if (!query.trim()) onBack();
              }} 
            />
          </Box>
          <Box marginTop={1} gap={2}>
            <Text color="gray">[Enter] to confirm empty string = Back</Text>
            <Text color="magenta">[Ctrl+G] to Generate Better Queries</Text>
            <Text color="blue">[Ctrl+R] to Run As-Is</Text>
          </Box>
        </Box>
      )}

      {/* Global Hotkeys for the input view */}
      {step === 'input' && (
        <GlobalHotkeyHandler 
          onCtrlG={handleGenerateSuggestions} 
          onCtrlR={() => query.trim() && handleRun(query)} 
        />
      )}

      {isGenerating && (
        <Box marginY={1}>
          <Text color="magenta"><Spinner type="dots" /> </Text>
          <Text>Brainstorming better queries with AI...</Text>
        </Box>
      )}

      {step === 'suggestions' && !isGenerating && (
        <Box flexDirection="column" marginY={1}>
          <Text color="yellow">Select a query to run:</Text>
          <SelectInput 
            items={[
              { label: `[Original] ${query}`, value: query },
              ...suggestions.map(s => ({ label: `[AI Suggestion] ${s}`, value: s })),
              { label: 'Cancel', value: 'cancel' }
            ]} 
            onSelect={(item) => {
              if (item.value === 'cancel') setStep('input');
              else handleRun(item.value);
            }} 
          />
        </Box>
      )}

      {step === 'running' && (
        <Box flexDirection="column" marginY={1} borderStyle="round" borderColor="blue" padding={1}>
          <Box marginBottom={1}>
            <Text color="cyan" bold><Spinner type="dots" /> PIPELINE RUNNING</Text>
          </Box>
          <Box flexDirection="column">
            {logs.map((log, i) => (
              <Text key={i} color={i === logs.length - 1 ? 'white' : 'gray'}>
                {i === logs.length - 1 ? '❯ ' : '  '}{log}
              </Text>
            ))}
          </Box>
          <Box marginTop={1}>
            <Text color="yellow" dimColor>Press [Ctrl+C] to gracefully pause the pipeline. Data is saved after each stage.</Text>
          </Box>
        </Box>
      )}



      {step === 'done' && (
        <Box flexDirection="column" marginY={1}>
          {errorMsg ? (
            <Text color="red" bold>Error: {errorMsg}</Text>
          ) : (
            <Text color="green" bold>Pipeline Complete!</Text>
          )}
          <Box marginTop={1}>
            <SelectInput 
              items={[{ label: 'Back to Menu', value: 'back' }]} 
              onSelect={onBack} 
            />
          </Box>
        </Box>
      )}
    </Box>
  );
};

// Helper component to capture global hotkeys in the input view
const GlobalHotkeyHandler: React.FC<{onCtrlG: () => void, onCtrlR: () => void}> = ({ onCtrlG, onCtrlR }) => {
  useInput((input, key) => {
    if (key.ctrl && input === 'g') onCtrlG();
    if (key.ctrl && input === 'r') onCtrlR();
  });
  return null;
};
