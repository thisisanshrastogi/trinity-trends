import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import { ConfigManager, TrinityConfig } from '../../config.manager.js';
import pc from 'picocolors';

interface SettingsProps {
  onBack: () => void;
}

export const Settings: React.FC<SettingsProps> = ({ onBack }) => {
  const [configManager] = useState(() => new ConfigManager());
  const [config, setConfig] = useState<TrinityConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<keyof TrinityConfig | null>(null);
  const [editValue, setEditValue] = useState('');

  useEffect(() => {
    setConfig(configManager.load());
  }, [configManager]);

  const SELECT_OPTIONS: Partial<Record<keyof TrinityConfig, string[]>> = {
    redditSort: ['relevance', 'hot', 'top', 'new', 'comments'],
    redditTime: ['hour', 'day', 'week', 'month', 'year', 'all'],
    youtubeUploadDate: ['Any time', 'Today', 'This week', 'This month', 'This year'],
    youtubeType: ['Any', 'Video', 'Channel', 'Playlist', 'Movie'],
    instagramSearchType: ['keyword', 'hashtag']
  };

  useInput((input, key) => {
    if (key.escape) {
      if (editing) setEditing(null);
      else onBack();
    }
  });

  if (!config) return <Text>Loading...</Text>;

  const handleSave = async () => {
    configManager.save(config);
    await configManager.updatePythonConfig(config.maxDocsPerCluster);
    setDirty(false);
    onBack();
  };

  const handleReset = async () => {
    const { DEFAULT_CONFIG } = await import('../../config.manager.js');
    setConfig({ ...DEFAULT_CONFIG });
    setDirty(true);
  };

  if (editing) {
    const isSelect = Object.keys(SELECT_OPTIONS).includes(String(editing));
    
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan" bold>Editing {String(editing)}</Text>
        
        {isSelect ? (
          <Box marginY={1}>
            <SelectInput
              items={(SELECT_OPTIONS[editing as keyof typeof SELECT_OPTIONS]!).map(opt => ({ label: opt, value: opt }))}
              onSelect={(item) => {
                setConfig({ ...config, [editing]: item.value });
                setDirty(true);
                setEditing(null);
              }}
            />
          </Box>
        ) : (
          <>
            <Box marginLeft={2}>
              <Text color="green">❯ </Text>
              <TextInput 
                value={editValue} 
                onChange={setEditValue} 
                onSubmit={() => {
                  let parsed: any = editValue;
                  if (['topK', 'maxDocsPerCluster', 'redditLimit', 'youtubeLimit', 'hackerNewsLimit', 'hackerNewsMinPoints', 'instagramLimit'].includes(String(editing))) {
                    parsed = parseInt(editValue, 10);
                    if (isNaN(parsed)) {
                      parsed = config[editing];
                    } else {
                      // Apply safety limits
                      if (editing === 'hackerNewsMinPoints') {
                        parsed = Math.max(0, Math.min(10000, parsed));
                      } else {
                        parsed = Math.max(1, Math.min(100, parsed));
                      }
                    }
                  }
                  setConfig({ ...config, [editing]: parsed });
                  setDirty(true);
                  setEditing(null);
                }} 
              />
            </Box>
            <Text color="gray">Press [Enter] to confirm. Numeric values are safely clamped (1-100 max).</Text>
          </>
        )}
      </Box>
    );
  }

  const items = [
    { value: 'topK', label: `Global: Top Expanded Topics ${pc.gray(`(Current: ${config.topK})`)}` },
    { value: 'maxDocsPerCluster', label: `Python: Max Docs per Cluster ${pc.gray(`(Current: ${config.maxDocsPerCluster})`)}` },
    { value: 'redditLimit', label: `Reddit: Fetch Limit ${pc.gray(`(Current: ${config.redditLimit})`)}` },
    { value: 'redditSort', label: `Reddit: Sort By ${pc.gray(`(Current: ${config.redditSort})`)}` },
    { value: 'redditTime', label: `Reddit: Time Filter ${pc.gray(`(Current: ${config.redditTime})`)}` },
    { value: 'youtubeLimit', label: `YouTube: Fetch Limit ${pc.gray(`(Current: ${config.youtubeLimit})`)}` },
    { value: 'youtubeUploadDate', label: `YouTube: Upload Date ${pc.gray(`(Current: ${config.youtubeUploadDate})`)}` },
    { value: 'youtubeType', label: `YouTube: Type Filter ${pc.gray(`(Current: ${config.youtubeType})`)}` },
    { value: 'hackerNewsLimit', label: `HackerNews: Fetch Limit ${pc.gray(`(Current: ${config.hackerNewsLimit})`)}` },
    { value: 'hackerNewsMinPoints', label: `HackerNews: Min Points ${pc.gray(`(Current: ${config.hackerNewsMinPoints})`)}` },
    { value: 'instagramLimit', label: `Instagram: Fetch Limit ${pc.gray(`(Current: ${config.instagramLimit})`)}` },
    { value: 'instagramSearchType', label: `Instagram: Search Type ${pc.gray(`(Current: ${config.instagramSearchType})`)}` },
    { value: 'save', label: pc.green('✔ Save Changes & Exit') },
    { value: 'reset', label: pc.cyan('↺ Reset to Defaults') },
    { value: 'cancel', label: pc.red('✖ Cancel Without Saving') }
  ];

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="magenta" bold>--- SETTINGS & CONFIGURATION ---</Text>
      {dirty && <Text color="yellow">Settings have unsaved changes!</Text>}
      
      <Box marginY={1}>
        <SelectInput 
          items={items} 
          onSelect={(item) => {
            if (item.value === 'cancel') onBack();
            else if (item.value === 'save') handleSave();
            else if (item.value === 'reset') handleReset();
            else {
              setEditing(item.value as keyof TrinityConfig);
              setEditValue(String(config[item.value as keyof TrinityConfig]));
            }
          }} 
        />
      </Box>
    </Box>
  );
};
