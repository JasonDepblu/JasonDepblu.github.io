// src/components/Header.jsx
import React from 'react';

function Header() {
  return (
    <header className="header">
      <div className="container">
        <span className="logo">🌟 Jason's Blog</span>
        <nav className="nav">
          <ul>
            <li><a href="/">Posts</a></li>
            <li><a href="/archive/">Archive</a></li>
            <li><a href="/chat/">Q&A</a></li>
            <li><a href="/tags/">Tags</a></li>
            <li><a href="/about/">About</a></li>
            <li><a href="/contact/">Contact</a></li>
          </ul>
        </nav>
      </div>
    </header>
  );
}

export default Header;