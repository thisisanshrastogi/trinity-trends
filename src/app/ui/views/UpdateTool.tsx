import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import pc from 'picocolors';
import { UpgradeManager } from '../../../upgrade/upgrade.manager.js';
import { getCurrentVersion } from '../../../upgrade/version.js';

interface UpdateToolProps {
  onBack: () => void;
}

export const UpdateTool: React.FC<UpdateToolProps> = ({ onBack }) => {
  const { exit } = useApp();
  const [status, setStatus] = useState<string>('Checking for updates...');
  const [step, setStep] = useState<'checking' | 'prompt' | 'updating' | 'done' | 'error'>('checking');
  const [updateResult, setUpdateResult] = useState<any>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const check = async () => {
      try {
        const manager = new UpgradeManager();
        const result = await manager.checkForUpdate();
        setUpdateResult(result);
        
        if (!result.updateAvailable) {
          setStatus(`You are running the latest version: v${result.currentVersion}`);
          setStep('done');
        } else {
          setStep('prompt');
        }
      } catch (err: any) {
        setError(err.message);
        setStep('error');
      }
    };
    check();
  }, []);

  useInput((input, key) => {
    if (key.escape) {
      if (step !== 'updating') {
        onBack();
      }
    }
    
    if (key.return && step === 'prompt') {
      startUpdate();
    }
    
    if (key.return && (step === 'done' || step === 'error')) {
      onBack();
    }
  });

  const startUpdate = async () => {
    setStep('updating');
    setStatus('Downloading update...');
    try {
      const manager = new UpgradeManager();
      let archivePath = '';
      if (updateResult.releaseInfo) {
        archivePath = await manager.downloadFullRelease(updateResult.releaseInfo);
      }
      
      setStatus('Applying update and running post-install hooks (this may take a minute)...');
      await manager.applyUpdate(archivePath, updateResult.latestVersion);
      
      setStatus(`Successfully updated to v${updateResult.latestVersion}! Please restart the application.`);
      setStep('done');
      setTimeout(() => process.exit(0), 2000);
    } catch (err: any) {
      setError(err.message);
      setStep('error');
    }
  };

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="blue">
      <Text color="bgBlue" bold> ⬆ UPGRADE MANAGER </Text>
      
      <Box marginY={1}>
        {(step === 'checking' || step === 'updating') && (
          <Text color="cyan"><Spinner type="dots" /> {status}</Text>
        )}
        
        {step === 'prompt' && (
          <Box flexDirection="column">
            <Text color="green" bold>Update available! v{updateResult?.currentVersion} ➔ v{updateResult?.latestVersion}</Text>
            {updateResult?.releaseInfo?.changelog && (
              <Box marginY={1} paddingLeft={2} borderStyle="single" borderColor="gray">
                <Text color="gray">{updateResult.releaseInfo.changelog}</Text>
              </Box>
            )}
            <Text color="yellow">Press <Text bold color="white">Enter</Text> to install, or <Text bold color="white">Escape</Text> to cancel.</Text>
          </Box>
        )}
        
        {step === 'done' && (
          <Box flexDirection="column">
            <Text color="green">{status}</Text>
            <Text color="gray">Press Enter to return.</Text>
          </Box>
        )}
        
        {step === 'error' && (
          <Box flexDirection="column">
            <Text color="red" bold>Update failed: {error}</Text>
            <Text color="yellow">The system automatically rolled back to the previous version.</Text>
            <Text color="gray">Press Enter to return.</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};
