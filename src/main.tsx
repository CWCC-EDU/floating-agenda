import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import NoteWindow from './NoteWindow';
import QuickCaptureWindow from './QuickCaptureWindow';
import SettingsWindow from './SettingsWindow';
import NoteListWindow from './NoteListWindow';
import DrawingBoardWindow from './DrawingBoardWindow';
import './styles.css';
import './feature-styles.css';
import './schedule-view.css';
import './utility-styles.css';

const view = new URLSearchParams(window.location.search).get('view');
const WindowContent = view === 'note' ? NoteWindow : view === 'quick' ? QuickCaptureWindow
  : view === 'drawing' ? DrawingBoardWindow : view === 'settings' ? SettingsWindow : view === 'notes' ? NoteListWindow : App;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WindowContent />
  </React.StrictMode>,
);
