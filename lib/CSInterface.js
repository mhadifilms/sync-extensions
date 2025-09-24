/* Minimal CSInterface shim for CEP panels */
(function(){
  if (window.CSInterface) return;
  var SystemPath = {
    APPLICATION: 'application',
    COMMON_FILES: 'commonFiles',
    EXTENSION: 'extension',
    HOST_APPLICATION: 'hostApplication',
    USER_DATA: 'userData'
  };
  function CSInterface(){}
  CSInterface.prototype.evalScript = function(script, callback){
    try {
      if (window.__adobe_cep__ && typeof window.__adobe_cep__.evalScript === 'function') {
        window.__adobe_cep__.evalScript(script, function(res){ if (callback) callback(res); });
      } else { if (callback) callback(''); }
    } catch (e) { if (callback) callback(''); }
  };
  CSInterface.prototype.getSystemPath = function(pathType){
    try { return (window.__adobe_cep__ && window.__adobe_cep__.getSystemPath) ? window.__adobe_cep__.getSystemPath(pathType) : ''; }
    catch(e){ return ''; }
  };
  CSInterface.SystemPath = (window.__adobe_cep__ && window.__adobe_cep__.SystemPath) ? window.__adobe_cep__.SystemPath : SystemPath;
  window.CSInterface = CSInterface;
})();
