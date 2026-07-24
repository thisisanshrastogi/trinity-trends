import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface PostData {
  source: string;
  url: string;
  text?: string;
  transcript?: string;
  score?: number;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
}

interface PostViewerProps {
  post: PostData;
  isActive?: boolean; // If this post is currently focused in a list
}

export const PostViewer: React.FC<PostViewerProps> = ({ post, isActive = false }) => {
  const [expanded, setExpanded] = useState(false);

  useInput((input, key) => {
    if (isActive && input === ' ') {
      setExpanded(prev => !prev);
    }
  });

  const truncateText = (text: string, length: number = 150) => {
    if (!text) return '';
    if (text.length <= length) return text;
    return text.substring(0, length) + '...';
  };

  const displayText = expanded ? post.text : truncateText(post.text || '');
  const displayTranscript = expanded ? post.transcript : truncateText(post.transcript || '');

  return (
    <Box 
      flexDirection="column" 
      borderStyle={isActive ? 'double' : 'round'} 
      borderColor={isActive ? 'green' : 'gray'} 
      padding={1}
      marginBottom={1}
      minHeight={16}
    >
      <Box justifyContent="space-between">
        <Text color="yellow" bold>[{post.source.toUpperCase()}]</Text>
        {isActive && <Text color="cyan" dimColor>Press [Space] to {expanded ? 'collapse' : 'expand'}</Text>}
      </Box>

      <Box marginY={1}>
        <Text color="blueBright" underline>{post.url || 'No URL available'}</Text>
      </Box>

      {post.text && (
        <Box flexDirection="column" marginBottom={post.transcript ? 1 : 0}>
          <Text bold color="white">Content:</Text>
          <Text>{displayText}</Text>
        </Box>
      )}

      {post.transcript && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="magenta">Transcript:</Text>
          <Text color="gray">{displayTranscript}</Text>
        </Box>
      )}

      <Box marginTop={1} gap={2}>
        {post.score !== undefined && <Text color="green">Score: {post.score}</Text>}
        {post.views !== undefined && <Text color="cyan">Views: {post.views}</Text>}
        {post.likes !== undefined && <Text color="red">Likes: {post.likes}</Text>}
        {post.comments !== undefined && <Text color="magenta">Comments: {post.comments}</Text>}
        {post.shares !== undefined && <Text color="blue">Shares: {post.shares}</Text>}
      </Box>
    </Box>
  );
};
