source "https://rubygems.org"

# 添加明确的 Ruby 版本要求
ruby '~> 3.3.5'  # 降低 Ruby 版本要求 3.3.5  3.2.2

# This will help ensure the proper Jekyll version is running.
gem 'jekyll', '~> 3.9.3' # 或 '~> 5.0.0' 以使用最新稳定版本
gem 'jekyll-sass-converter'
gem 'csv'

gem 'sass', '~> 3.7.0'

# GitHub Pages
# gem "github-pages", group: :jekyll_plugins
gem "github-pages", "~> 228", group: :jekyll_plugins

# Plugins
group :jekyll_plugins do
  gem "jekyll-feed"
  gem "jekyll-sitemap"
  gem "jekyll-seo-tag"
  gem "jekyll-remote-theme"
  gem 'jekyll-lunr-js-search'
end


# Windows and JRuby does not include zoneinfo files, so bundle the tzinfo-data gem
platforms :mingw, :x64_mingw, :mswin, :jruby do
  gem "tzinfo", ">= 1", "< 3"
  gem "tzinfo-data"
end

# Performance-booster for watching directories on Windows
gem "wdm", "~> 0.1.1", :platforms => [:mingw, :x64_mingw, :mswin]

# Lock `http_parser.rb` gem to `v0.6.x` on JRuby builds since newer versions of the gem
# do not have a Java counterpart.
gem "http_parser.rb", "~> 0.6.0", :platforms => [:jruby]

# Required for Ruby 3.0+
gem "webrick", "~> 1.7"

gem "faraday-retry"