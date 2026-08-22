import { useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore.js';

export function CredentialsPanel() {
  const { credentials, addCredential } = useWorkflowStore();
  const [name, setName] = useState('');
  const [token, setToken] = useState('');

  return (
    <div className="credentials-panel">
      <span className="credentials-panel__count">
        {credentials.length} credential{credentials.length === 1 ? '' : 's'}
      </span>
      <input placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
      <input placeholder="bearer token" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
      <button
        className="btn btn--authorize"
        disabled={!name || !token}
        onClick={async () => {
          await addCredential(name, token);
          setName('');
          setToken('');
        }}
      >
        Add credential
      </button>
    </div>
  );
}
