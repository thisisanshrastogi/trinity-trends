import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import * as fs from 'fs';
import * as path from 'path';
import pc from 'picocolors';

interface EnvConfigProps {
  onBack: () => void;
}

export const EnvConfig: React.FC<EnvConfigProps> = ({ onBack }) => {
  const [envPath, setEnvPath] = useState<string>('');
  const [envVars, setEnvVars] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    // Find the installation root (where package.json lives)
    let root = process.cwd();
    while (!fs.existsSync(path.join(root, "package.json")) && root !== "/") {
      root = path.dirname(root);
    }
    const envFile = path.join(root, '.env');
    setEnvPath(envFile);

    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, 'utf-8');
      const vars: Record<string, string> = {};
      content.split('\n').forEach(line => {
        const match = line.match(/^([^#\s][^=]+)=(.*)$/);
        if (match) {
          vars[match[1].trim()] = match[2].trim();
        }
      });
      // Ensure required vars exist even if empty
      ['GEMINI_API_KEY', 'GROQ_API_KEY', 'INSTAGRAM_USERNAME', 'INSTAGRAM_PASSWORD'].forEach(k => {
        if (vars[k] === undefined) vars[k] = '';
      });
      setEnvVars(vars);
    } else {
      setEnvVars({
        GEMINI_API_KEY: '',
        GROQ_API_KEY: '',
        INSTAGRAM_USERNAME: '',
        INSTAGRAM_PASSWORD: ''
      });
    }
  }, []);

  useInput((input, key) => {
    if (key.escape) {
      if (editing) setEditing(null);
      else onBack();
    }
  });

  const handleSave = () => {
    let content = '';
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, 'utf-8');
    }
    
    const updatedVars = { ...envVars };
    const lines = content.split('\n');
    const newLines: string[] = [];
    
    for (const line of lines) {
      const match = line.match(/^([^#\s][^=]+)=/);
      if (match) {
        const key = match[1].trim();
        if (updatedVars[key] !== undefined) {
          newLines.push(`${key}=${updatedVars[key]}`);
          delete updatedVars[key];
          continue;
        }
      }
      newLines.push(line);
    }
    
    for (const [key, val] of Object.entries(updatedVars)) {
      if (val !== '') {
         newLines.push(`${key}=${val}`);
      }
    }
    
    fs.writeFileSync(envPath, newLines.join('\n'));
    setDirty(false);
    onBack();
  };

  if (editing) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan" bold>Editing {editing}</Text>
        <Box marginLeft={2} marginY={1}>
          <Text color="green">❯ </Text>
          <TextInput 
            value={editValue} 
            onChange={setEditValue} 
            onSubmit={() => {
              setEnvVars(prev => ({ ...prev, [editing]: editValue }));
              setDirty(true);
              setEditing(null);
            }} 
          />
        </Box>
        <Text color="gray">Press [Enter] to confirm, or [Escape] to cancel.</Text>
      </Box>
    );
  }

  const items = Object.keys(envVars).map(key => {
    const val = envVars[key];
    const displayVal = val ? (key.includes('PASSWORD') || key.includes('KEY') ? '********' : val) : pc.red('(Not Set)');
    return { value: key, label: `${key}: ${displayVal}` };
  });

  items.push({ value: 'save', label: pc.green('✔ Save Changes & Exit') });
  items.push({ value: 'cancel', label: pc.red('✖ Cancel Without Saving') });

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="blue" bold>--- ENVIRONMENT CONFIGURATION ---</Text>
      <Text color="gray" italic>File Path: {envPath}</Text>
      {dirty && <Text color="yellow">You have unsaved changes!</Text>}
      
      <Box marginY={1}>
        <SelectInput 
          items={items} 
          onSelect={(item) => {
            if (item.value === 'cancel') onBack();
            else if (item.value === 'save') handleSave();
            else {
              setEditing(item.value);
              setEditValue(envVars[item.value] || '');
            }
          }} 
        />
      </Box>
    </Box>
  );
};
