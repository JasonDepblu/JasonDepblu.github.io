document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('h4').forEach(header => {
    const content = header.nextElementSibling;
    if (content) {
      header.classList.add('toggle-header');
      content.classList.add('toggle-content');
      content.style.display = 'none';

      header.addEventListener('click', () => {
        const isVisible = content.style.display === 'block';
        content.style.display = isVisible ? 'none' : 'block';
        header.classList.toggle('active', !isVisible);
      });
    }
  });
});