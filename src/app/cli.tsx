#!/usr/bin/env node
import React, { useState } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';

import { SqliteRepository } from '../storage/sqlite/sqlite.repository.js';
import { User } from '../storage/storage.types.js';
import { getCurrentVersion } from '../upgrade/version.js';

import { Banner } from './ui/components/Banner.js';
import { MainMenu } from './ui/views/MainMenu.js';
import { RunPipeline } from './ui/views/RunPipeline.js';
import { TranscriptTool } from './ui/views/TranscriptTool.js';
import { PastSessions } from './ui/views/PastSessions.js';
import { Settings } from './ui/views/Settings.js';
import { UpdateTool } from './ui/views/UpdateTool.js';

const repo = new SqliteRepository();

const App = () => {
  const { exit } = useApp();
  const [view, setView] = useState<'login' | 'register' | 'menu' | 'new' | 'config' | 'past' | 'transcript' | 'update'>('login');
  
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [pastSessionId, setPastSessionId] = useState<string | undefined>();

  useInput((input, key) => {
    if (key.escape && (view === 'login' || view === 'register')) exit();
    if (key.ctrl && input === 'c') process.exit(0);
  });

  const handleLoginSubmit = () => {
    if (!email.includes('@')) return;
    const existingUser = repo.getUserByEmail(email);
    if (existingUser) {
      setUser(existingUser);
      setView('menu');
    } else {
      setView('register');
    }
  };

  const handleRegisterSubmit = () => {
    if (!name.trim()) return;
    const newUser = repo.createUser({ email, name });
    setUser(newUser);
    setView('menu');
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Banner />
      
      {view === 'login' && (
        <Box flexDirection="column">
          <Text color="cyan">Enter your email to login:</Text>
          <Box marginLeft={2}>
            <Text color="green">❯ </Text>
            <TextInput value={email} onChange={setEmail} onSubmit={handleLoginSubmit} />
          </Box>
        </Box>
      )}

      {view === 'register' && (
        <Box flexDirection="column">
          <Text color="yellow">User not found. Let's create a new profile.</Text>
          <Text color="cyan">Enter your name:</Text>
          <Box marginLeft={2}>
            <Text color="green">❯ </Text>
            <TextInput value={name} onChange={setName} onSubmit={handleRegisterSubmit} />
          </Box>
        </Box>
      )}

      {view === 'menu' && (
        <Box flexDirection="column">
          <Text color="green">Welcome, {user?.name}!</Text>
          <MainMenu 
            version={getCurrentVersion()} 
            onSelect={(val) => {
              if (val === 'exit') exit();
              else setView(val as any);
            }} 
          />
        </Box>
      )}

      {view === 'new' && user && (
        <RunPipeline 
          user={user} 
          onBack={() => setView('menu')} 
          onComplete={(sessionId) => {
            setPastSessionId(sessionId);
            setView('past');
          }}
        />
      )}

      {view === 'transcript' && (
        <TranscriptTool onBack={() => setView('menu')} />
      )}

      {view === 'past' && user && (
        <PastSessions 
          user={user} 
          onBack={() => {
            setPastSessionId(undefined);
            setView('menu');
          }} 
          initialSessionId={pastSessionId}
        />
      )}

      {view === 'config' && (
        <Settings onBack={() => setView('menu')} />
      )}

      {view === 'update' && (
        <UpdateTool onBack={() => setView('menu')} />
      )}
    </Box>
  );
};

// Override console methods to prevent Ink disruption by standard logs
console.log = () => {};
console.error = () => {}; 
console.warn = () => {};

render(<App />, { exitOnCtrlC: false });
