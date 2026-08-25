-- Demo users (password = <role>123, hashed sha256("lmpc-salt:" + password))
INSERT OR IGNORE INTO users (user_id, username, password_hash, full_name, role, region_id) VALUES
  ('u_admin',      'admin',      'c9a3c816dd358fe7cdc72727f4bb15a16a1ea3254fb840842e2f041f5b728351', 'System Administrator',            'admin',      'IN-ALL'),
  ('u_controller', 'controller', '8f6c5defde4092ccb3f8c82cac6dea3eb6dc8ba9ca9ba3bb5c36d8c28645ec94', 'State Controller (Maharashtra)',  'controller', 'IN-MH'),
  ('u_officer',    'officer',    '300a0e48ec7dd2b6f1c0ac8a56650f7d80c7d111a23d11eb8a0b282ca1bdf895', 'LM Officer R. Sharma',            'officer',    'IN-MH'),
  ('u_consumer',   'consumer',   '7de626c9f17e0839432c4916646e46a84c9595c6dd197742370b5a9c76003c98', 'Consumer Complainant',            'consumer',   'IN-MH');
