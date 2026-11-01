// Icons are local assets. Never interpret user metadata as HTML or icon names.
(() => {
  const names = new Set(["joystick","gamepad-2","folders","settings","folder-open","pencil","trash-2","rotate-ccw","book-open","maximize","play","history","external-link","x","link","search","dice-5","image","rocket","circle-x","chevron-right","chevron-down","save","plus","circle-check","hourglass","party-popper","globe","file-text","download","triangle-alert","disc-3","star"]);
  const labels = {
  "msg.7a28a67ea0": "save",
  "msg.856129e2b9": "plus",
  "msg.cd70ffa805": "search",
  "msg.a6ed6dbae7": "chevron-down",
  "msg.ab21560c63": "chevron-down",
  "msg.124ba96734": "play",
  "msg.49c4bbcec2": "play",
  "msg.3e86cbbd60": "dice-5",
  "msg.01cd2f796a": "search",
  "msg.2acc658bfe": "search",
  "msg.671f63fed3": "search",
  "msg.339fbb2a97": "folder-open",
  "msg.ad0393fcf5": "folder-open",
  "msg.5367e21bbc": "folder-open",
  "msg.429da598be": "globe",
  "msg.dd0eff6b0e": "file-text",
  "msg.e123765ce5": "folder-open",
  "msg.a212045475": "save",
  "msg.e5a14dce48": "joystick",
  "msg.3c798c6095": "folder-open",
  "msg.1a479fdd86": "download",
  "msg.5e4e6ccd15": "x",
  "msg.7350eaa7ad": "folder-open",
  "msg.b217e5f31b": "gamepad-2",
  "msg.0c63ce9246": "folder-open",
  "msg.d7d6656c6b": "gamepad-2",
  "msg.19f160f0a5": "gamepad-2",
  "msg.38d2c6f6ad": "save",
  "msg.9ca8f9dee7": "folder-open",
  "msg.79ee14b77a": "trash-2",
  "msg.67fa9628c4": "play",
  "msg.02f344eb6e": "pencil",
  "msg.b3a8ed7ae3": "joystick",
  "msg.4fe8c2a22f": "folder-open",
  "msg.5bedcd421f": "folder-open",
  "msg.e4998f3861": "disc-3",
  "msg.e7f0211399": "globe",
  "msg.6b39d242e1": "image",
  "msg.dcdcf57086": "pencil",
  "sofa.play": "play"
};
  function html(name) {
    if (!names.has(name)) throw new Error('Unknown interface icon: ' + name);
    return '<span class="ui-icon" data-icon="' + name + '" aria-hidden="true"></span>';
  }
  function set(node, name) { node.classList?.remove?.('has-ui-icon'); node.innerHTML = html(name); }
  function label(node, text, name) {
    set(node, name);
    node.appendChild(document.createTextNode(' ' + text));
  }
  globalThis.OpenCabinetIcons = { html, set, label, forMessage: key => labels[key] || null };
})();
