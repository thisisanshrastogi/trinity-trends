import React from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import pc from 'picocolors';

interface MenuProps {
  onSelect: (value: string) => void;
  version: string;
}

export const MainMenu: React.FC<MenuProps> = ({ onSelect, version }) => {
  const { exit } = useApp();
  useInput((input, key) => {
    if (key.escape) exit();
  });

  const items = [
    { label: pc.green('▶ Run New Search Pipeline'), value: 'new' },
    { label: pc.cyan('⚙ Edit Configuration'), value: 'config' },
    { label: pc.yellow('◷ View Past Sessions'), value: 'past' },
    { label: pc.magenta('☊ Transcript Tool (Download & Transcribe)'), value: 'transcript' },
    { label: pc.red('✖ Exit'), value: 'exit' },
  ];

  return (
    <Box flexDirection="column">
      <Box marginY={1}>
        <Text color="gray">MAIN MENU (v{version})</Text>
      </Box>
      <SelectInput
        items={items}
        onSelect={(item) => onSelect(item.value)}
      />
    </Box>
  );
};
