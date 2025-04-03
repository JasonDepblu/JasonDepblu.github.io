# _plugins/navigation-export.rb
require 'json'

Jekyll::Hooks.register :site, :after_init do |site|
  # 确保目标目录存在
  FileUtils.mkdir_p('_site/chat/data')

  # 读取导航数据
  nav_data = site.data['navigation']

  # 将导航数据转换为 JSON 并保存
  File.open('_site/chat/data/navigation.json', 'w') do |f|
    f.write(JSON.pretty_generate(nav_data))
  end

  # 同时保存到公共目录，以便开发时使用
  FileUtils.mkdir_p('public/data')
  File.open('public/data/navigation.json', 'w') do |f|
    f.write(JSON.pretty_generate(nav_data))
  end
end