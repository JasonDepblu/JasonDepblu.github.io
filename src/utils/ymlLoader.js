// src/utils/ymlLoader.js
import yaml from 'js-yaml';

export async function loadNavigationConfig() {
  try {
    const response = await fetch('/_data/navigation.yml');

    if (!response.ok) {
      throw new Error(`Failed to load navigation.yml: ${response.status} ${response.statusText}`);
    }

    const ymlText = await response.text();
    const navData = yaml.load(ymlText);

    // Process the loaded data based on Jekyll navigation format
    // Jekyll typically uses a "main" key for primary navigation
    if (navData && navData.main && Array.isArray(navData.main)) {
      return navData.main.map(item => {
        // Convert children array to links array for consistency
        if (item.children && Array.isArray(item.children)) {
          return {
            ...item,
            links: item.children
          };
        }
        return item;
      });
    }

    return navData || [];
  } catch (error) {
    console.error('Error loading navigation configuration:', error);
    return [];
  }
}

// Alternative implementation for scenarios where we need to bundle the YAML directly
export function getStaticNavigationConfig() {
  // You would need to pre-process and include the navigation data here
  // This can be useful if you want to include the data at build time
  return [
    {
      title: "Home",
      url: "/"
    },
    {
      title: "About",
      url: "/about/"
    },
    {
      title: "Projects",
      links: [
        {
          title: "ChatBot",
          url: "/chat/"
        },
        // Add more links as needed
      ]
    },
    // Add more navigation items as needed
  ];
}