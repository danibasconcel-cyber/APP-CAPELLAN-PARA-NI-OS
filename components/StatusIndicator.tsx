
import React from 'react';
import { ConnectionState } from '../types';

interface StatusIndicatorProps {
  state: ConnectionState;
  isSpeaking: boolean;
  isListening: boolean;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({ state, isSpeaking, isListening }) => {
  const getStatus = () => {
    if (state === ConnectionState.CONNECTED) {
      if (isSpeaking) return { text: 'Hablando...', color: 'bg-blue-500', pulse: true };
      if (isListening) return { text: 'Escuchando...', color: 'bg-green-500', pulse: true };
      return { text: 'Conectado', color: 'bg-green-500', pulse: false };
    }
    switch (state) {
      case ConnectionState.IDLE:
        return { text: 'Listo para empezar', color: 'bg-gray-400', pulse: false };
      case ConnectionState.CONNECTING:
        return { text: 'Conectando...', color: 'bg-yellow-500', pulse: true };
      case ConnectionState.ERROR:
        return { text: 'Error de conexión', color: 'bg-red-500', pulse: false };
      case ConnectionState.CLOSED:
        return { text: 'Desconectado', color: 'bg-gray-400', pulse: false };
      default:
        return { text: 'Desconocido', color: 'bg-gray-400', pulse: false };
    }
  };

  const { text, color, pulse } = getStatus();

  return (
    <div className="flex items-center justify-center space-x-2 text-gray-600">
      <div className={`w-3 h-3 rounded-full ${color} ${pulse ? 'animate-pulse' : ''}`}></div>
      <span>{text}</span>
    </div>
  );
};

export default StatusIndicator;
