import React from 'react';

function StreamToggle({ checked, onChange }) {
  return (
    <div className="toggle-container">
      <label className="toggle-switch">
        <input
          type="checkbox"
          id="stream-toggle"
          checked={checked}
          onChange={onChange}
        />
        <span className="toggle-slider"></span>
      </label>
      <span className="toggle-text">流式响应</span>
    </div>
  );
}

export default StreamToggle;