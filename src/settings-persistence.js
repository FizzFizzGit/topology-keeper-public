// data.jsonの保存順序を一本化する。Vault内ファイルの保存は扱わない。
// 呼び出し時点のJSONの写しを作り、待機中のstate変更から切り離す。
class SettingsPersistence {
  constructor(write, onError) {
    this.write = write;
    this.onError = onError;
    this.tail = Promise.resolve();
  }

  save(data) {
    let snapshot;
    try { snapshot = JSON.parse(JSON.stringify(data)); }
    catch (error) {
      const failed = Promise.reject(error);
      failed.catch(error => this.onError(error));
      return failed;
    }
    const operation = this.tail.then(() => this.write(snapshot));
    // 位置保存のようにawaitしない操作も通知する。待機列だけを回復し、
    // 呼び出し元へ返すoperationの失敗は維持する。
    this.tail = operation.catch(error => { this.onError(error); });
    return operation;
  }

  whenIdle() { return this.tail; }
}
module.exports = { SettingsPersistence };
