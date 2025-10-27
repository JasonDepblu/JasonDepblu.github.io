// src/components/JekyllNavigation.jsx
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import './Navigation.css';

function JekyllNavigation() {
  const [navigation, setNavigation] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // 加载导航数据
    fetch(`${process.env.PUBLIC_URL}/data/navigation.json`)
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to load navigation data');
        }
        return response.json();
      })
      .then(data => {
        setNavigation(data);
        setIsLoading(false);
      })
      .catch(err => {
        console.error('Error loading navigation:', err);
        setError('Failed to load navigation. Please try again later.');
        setIsLoading(false);
      });
  }, []);

  if (isLoading) return <div className="nav-loading">Loading navigation...</div>;
  if (error) return <StaticNavigation navigation={fallbackNavigation} />;
  if (!navigation || !navigation.main) return null;

  return (
    <nav className="main-navigation">
      <ul className="nav-list">
        {navigation.main.map((item, index) => (
          <li key={index} className="nav-item">
            <Link
              to={item.url.replace(/^\/chat\//, '/')}
              className="nav-link"
            >
              {item.title}
            </Link>

            {item.children && item.children.length > 0 && (
              <ul className="nav-sublist">
                {item.children.map((child, childIndex) => (
                  <li key={childIndex} className="nav-subitem">
                    <Link
                      to={child.url.replace(/^\/chat\//, '/')}
                      className="nav-sublink"
                    >
                      {child.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

// 后备的静态导航数据
const fallbackNavigation = {
  main: [
    { title: "Home", url: "/" },
    { title: "About", url: "/about/" },
    { title: "Blog", url: "/blog/" },
    { title: "Chat", url: "/chat/" }
  ]
};

// ...

// 添加一个静态导航组件
function StaticNavigation({ navigation }) {
  return (
    <nav className="main-navigation">
      <ul className="nav-list">
        {navigation.main.map((item, index) => (
          <li key={index} className="nav-item">
            <Link to={item.url.replace(/^\/chat\//, '/')} className="nav-link">
              {item.title}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
export default JekyllNavigation;