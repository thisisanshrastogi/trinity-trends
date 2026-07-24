import React from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import pc from 'picocolors';

interface SettingsMenuProps {
  onSelect: (value: 'config' | 'env' | 'back') => void;
}

export const SettingsMenu: React.FC<SettingsMenuProps> = ({ onSelect }) => {
  useInput((input, key) => {
    if (key.escape) onSelect('back');
  });

  const items = [
    { label: pc.cyan('Edit Configuration (Limits, Tokens, etc.)'), value: 'config' },
    { label: pc.cyan('Edit Environment Variables (.env)'), value: 'env' },
    { label: pc.red('Back to Main Menu'), value: 'back' },
  ];

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="gray">
      <Text color="cyan" bold>--- SETTINGS MENU ---</Text>
      <Box marginY={1}>
        <SelectInput 
          items={items} 
          onSelect={(item) => onSelect(item.value as 'config' | 'env' | 'back')} 
        />
      </Box>
    </Box>
  );
};
