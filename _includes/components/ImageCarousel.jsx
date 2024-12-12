import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const ImageCarousel = () => {
  const images = [
    { url: '/assets/images/slide1.jpg', caption: '欢迎来到我的博客' },
    { url: '/assets/images/slide2.jpg', caption: '技术研究与分享' },
    { url: '/assets/images/slide3.jpg', caption: '学术论文解读' }
];
};

export default ImageCarousel;