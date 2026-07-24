import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import SelectInput from 'ink-select-input';
import { AudioTranscriber } from '../../../collectors/core/audio.transcriber.js';
import { SqliteRepository } from '../../../storage/sqlite/sqlite.repository.js';
import pc from 'picocolors';

interface TranscriptToolProps {
  onBack: () => void;
}

export const TranscriptTool: React.FC<TranscriptToolProps> = ({ onBack }) => {
  const repo = useMemo(() => new SqliteRepository(), []);

  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'error' | 'history'>('idle');
  const [transcript, setTranscript] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [history, setHistory] = useState<any[]>([]);

  useInput((input, key) => {
    if (key.ctrl && input === 'h') {
      setHistory(repo.getTranscripts());
      setStatus('history');
      return;
    }
    if (key.escape) {
      if (status !== 'idle' && status !== 'running') {
        setStatus('idle');
        setUrl('');
      } else {
        onBack();
      }
    }
  });

  const handleSubmit = async () => {
    const trimmed = url.trim();
    if (trimmed.toLowerCase() === 'history') {
      setHistory(repo.getTranscripts());
      setStatus('history');
      return;
    }

    if (!trimmed) return;
    setStatus('running');
    setTranscript('');
    setErrorMsg('');

    try {
      const transcriber = new AudioTranscriber();
      const result = await transcriber.processUrl(trimmed);

      if (result && result.transcript && result.transcript.trim()) {
        const finalTranscript = result.transcript.trim();
        repo.saveTranscript(trimmed, finalTranscript);
        setTranscript(finalTranscript);
        setStatus('success');
      } else {
        setErrorMsg('No transcript generated (maybe it has no audio?)');
        setStatus('error');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to generate transcript');
      setStatus('error');
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>--- Transcript Tool ---</Text>

      {status === 'idle' && (
        <Box flexDirection="column" marginY={1}>
          <Text color="yellow">Enter a media URL (e.g. Instagram Reels, YouTube Shorts) to download and transcribe.</Text>
          <Text color="gray">(Type "history" or press Ctrl+H to view past transcripts, or leave blank to go back)</Text>
          <Box marginLeft={2}>
            <Text color="green">❯ </Text>
            <TextInput
              value={url}
              onChange={setUrl}
              onSubmit={() => {
                if (url.trim() === '') onBack();
                else handleSubmit();
              }}
            />
          </Box>
        </Box>
      )}

      {status === 'history' && (
        <Box flexDirection="column" marginY={1}>
          <Text color="cyan" bold>--- Transcript History ---</Text>
          {history.length === 0 ? (
            <Box flexDirection="column" marginY={1}>
              <Text color="yellow">No past transcripts found.</Text>
              <SelectInput items={[{ label: pc.red('« Back'), value: 'back' }]} onSelect={() => { setStatus('idle'); setUrl(''); }} />
            </Box>
          ) : (
            <SelectInput
              limit={10}
              items={[
                { label: pc.red('« Back'), value: 'back' },
                ...history.map(h => ({
                  label: `[${new Date(h.created_at).toLocaleString()}] ${h.url}`,
                  value: h.id
                }))
              ]}
              onSelect={(item) => {
                if (item.value === 'back') {
                  setStatus('idle');
                  setUrl('');
                } else {
                  const h = history.find(x => x.id === item.value);
                  if (h) {
                    setTranscript(h.transcript);
                    setStatus('success');
                  }
                }
              }}
            />
          )}
        </Box>
      )}

      {status === 'running' && (
        <Box marginY={1}>
          <Text color="magenta"><Spinner type="dots" /> </Text>
          <Text>Downloading and Transcribing... (This may take a minute)</Text>
        </Box>
      )}

      {status === 'success' && (
        <Box flexDirection="column" marginY={1}>
          <Text color="green" bold>Success!</Text>
          <Box borderStyle="round" borderColor="gray" padding={1} marginY={1}>
            <Text>{transcript}</Text>
          </Box>
          <Text color="gray">Press Space/Enter to go back.</Text>
          <Box marginLeft={2}>
            <Text color="green">❯ </Text>
            <TextInput value={''} onChange={() => { }} onSubmit={() => { setStatus('idle'); setUrl(''); }} />
          </Box>
        </Box>
      )}

      {status === 'error' && (
        <Box flexDirection="column" marginY={1}>
          <Text color="red" bold>Error: {errorMsg}</Text>
          <Text color="gray">Press Space/Enter to go back.</Text>
          <Box marginLeft={2}>
            <Text color="green">❯ </Text>
            <TextInput value={''} onChange={() => { }} onSubmit={() => { setStatus('idle'); setUrl(''); }} />
          </Box>
        </Box>
      )}
    </Box>
  );
};
